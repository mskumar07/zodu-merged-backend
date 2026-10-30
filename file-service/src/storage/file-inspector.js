// Decides what an uploaded file really is from its bytes, and rejects content
// that can run code when someone opens it. Pure functions, unit tested.
//
// Never trusted: the browser's Content-Type (Windows sends CSV as
// application/vnd.ms-excel, an attacker sends anything) and the file name on
// its own. The name's extension must agree with the detected content, so a
// renamed .exe, .html or .svg is refused.
//
// This is a first line of defence. In production also run uploads through an
// antivirus scanner (e.g. ClamAV) before they become downloadable.

const path = require('path');
const zlib = require('zlib');
const { MIME, FILE_TYPES } = require('./modules');
const { httpError } = require('./key-builder');

const MB = 1024 * 1024;
const MAX_ZIP_ENTRIES      = 5000;
const MAX_UNZIPPED_BYTES   = 200 * MB;   // zip-bomb guard for .docx / .xlsx
const MAX_PART_BYTES       = 50 * MB;    // largest single part we inflate to inspect
const MAX_PDF_INFLATE      = 50 * MB;    // total budget for PDF object streams

const unsupported = (msg) => httpError(415, msg);
const dangerous   = (msg) => httpError(422, msg);

const bytesAt = (buf, sig, offset = 0) =>
  buf.length >= offset + sig.length && sig.every((b, i) => buf[offset + i] === b);
const textAt = (buf, offset, str) => buf.toString('latin1', offset, offset + str.length) === str;
const utf16 = (s) => Buffer.from(s, 'utf16le');

const SIG = {
  JPEG: [0xff, 0xd8, 0xff],
  PNG:  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  OLE:  [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],   // legacy Office (.doc/.xls/.ppt/.msi)
  ZIP:  [0x50, 0x4b, 0x03, 0x04],                           // .docx / .xlsx are ZIP files
};

// Returns { mime, ext } or throws 415 (not an accepted type) / 422 (dangerous content).
function inspectFile(buffer, originalName) {
  if (!buffer?.length) throw httpError(400, 'File is empty');

  const nameExt = path.extname(String(originalName || '')).slice(1).toLowerCase();
  const mime = detect(buffer, nameExt);
  const type = FILE_TYPES[mime];

  if (!type.names.includes(nameExt)) {
    throw unsupported(`File name ends in ".${nameExt || '(none)'}" but the content is ${type.ext.toUpperCase()}`);
  }
  return { mime, ext: type.ext };
}

function detect(buf, nameExt) {
  if (bytesAt(buf, SIG.JPEG)) return MIME.JPEG;
  if (bytesAt(buf, SIG.PNG))  return MIME.PNG;
  if (textAt(buf, 0, 'RIFF') && textAt(buf, 8, 'WEBP')) return MIME.WEBP;
  if (textAt(buf, 0, '%PDF-')) { checkPdf(buf); return MIME.PDF; }
  if (bytesAt(buf, SIG.OLE)) { checkDoc(buf); return MIME.DOC; }
  if (bytesAt(buf, SIG.ZIP)) return checkOoxml(buf);
  // CSV has no signature: only considered when the name says .csv, then checked as text.
  if (nameExt === 'csv') { checkCsv(buf); return MIME.CSV; }
  throw unsupported('Unsupported file type. Allowed: JPG, PNG, WEBP, PDF, DOC, DOCX, XLSX, CSV');
}

// ── PDF ────────────────────────────────────────────────────────────────────
// PDFs can run JavaScript, launch programs and carry embedded files.
// Names may be hex-escaped (/J#61vaScript) or hidden in compressed object
// streams, so both are decoded before matching.
const PDF_ACTIVE = /\/(JavaScript|JS|Launch|EmbeddedFiles?|RichMedia|SubmitForm|ImportData|GoToE)(?![A-Za-z0-9])/;

function checkPdf(buf) {
  const raw = buf.toString('latin1');
  if (/\/Encrypt(?![A-Za-z0-9])/.test(raw)) {
    throw dangerous('Encrypted or password-protected PDFs cannot be checked and are not allowed');
  }

  // Scan everything outside streams (stream bodies are binary and would give
  // false matches), plus the inflated contents of object streams.
  const chunks = [];
  let pos = 0;
  let budget = MAX_PDF_INFLATE;
  const streamStart = /stream\r?\n/g;
  let m;
  while ((m = streamStart.exec(raw))) {
    if (raw.slice(m.index - 3, m.index) === 'end') continue;
    const bodyStart = m.index + m[0].length;
    const bodyEnd = raw.indexOf('endstream', bodyStart);
    if (bodyEnd === -1) break;

    chunks.push(raw.slice(pos, m.index));
    const dict = raw.slice(raw.lastIndexOf('obj', m.index), m.index);
    if (/\/ObjStm/.test(dict) && /\/FlateDecode/.test(dict)) {
      let inflated;
      try {
        inflated = zlib.inflateSync(buf.subarray(bodyStart, bodyEnd), { maxOutputLength: budget });
      } catch (err) {
        if (err.code === 'ERR_BUFFER_TOO_LARGE') throw dangerous('PDF is too complex to check');
        inflated = Buffer.alloc(0);   // undecodable stream: readers can't use it either
      }
      budget -= inflated.length;
      chunks.push(inflated.toString('latin1'));
    }
    pos = bodyEnd + 'endstream'.length;
    streamStart.lastIndex = pos;
  }
  chunks.push(raw.slice(pos));

  for (const chunk of chunks) {
    const decoded = chunk.replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    const hit = decoded.match(PDF_ACTIVE);
    if (hit) throw dangerous(`PDF contains active content (/${hit[1]}) and is not allowed`);
  }
}

// ── Legacy Word .doc (OLE compound file) ───────────────────────────────────
// OLE is also used by .xls, .ppt and .msi installers, so require a Word
// stream, and refuse VBA macros. Directory names are stored as UTF-16LE.
function checkDoc(buf) {
  if (!buf.includes(utf16('WordDocument'))) {
    throw unsupported('Legacy Office files other than Word .doc are not accepted (save Excel files as .xlsx)');
  }
  if (buf.includes(utf16('_VBA_PROJECT')) || buf.includes(utf16('Macros'))) {
    throw dangerous('Word document contains macros and is not allowed');
  }
}

// ── .docx / .xlsx (Office Open XML = ZIP) ──────────────────────────────────
function checkOoxml(buf) {
  const entries = zipEntries(buf);

  const total = entries.reduce((sum, e) => sum + e.size, 0);
  if (total > MAX_UNZIPPED_BYTES) throw dangerous('Archive expands to an unsafe size (possible zip bomb)');

  for (const { name } of entries) {
    if (name.includes('..') || name.startsWith('/') || name.includes('\\')) {
      throw dangerous('Office file contains unsafe paths');
    }
    if (/vbaProject\.bin$/i.test(name)) throw dangerous('Office file contains macros and is not allowed');
    if (/(^|\/)activeX\//i.test(name)) throw dangerous('Office file contains ActiveX controls and is not allowed');
    if (/(^|\/)embeddings\/oleObject[^/]*\.bin$/i.test(name)) {
      throw dangerous('Office file contains embedded objects and is not allowed');
    }
    if (/^xl\/externalLinks\//i.test(name)) {
      throw dangerous('Spreadsheet links to external sources (DDE risk) and is not allowed');
    }
  }

  const contentTypes = entries.find((e) => e.name === '[Content_Types].xml');
  if (!contentTypes) throw unsupported('ZIP archives are not accepted');
  const ct = readEntry(buf, contentTypes, 1 * MB).toString('utf8');

  if (/macroEnabled/i.test(ct)) throw dangerous('Macro-enabled Office files are not allowed');

  if (ct.includes('wordprocessingml.document.main+xml')) {
    const doc = entries.find((e) => e.name === 'word/document.xml');
    if (doc) {
      const xml = readEntry(buf, doc, MAX_PART_BYTES).toString('utf8');
      // DDE fields run commands when the document is opened.
      if (/<w:instrText[^>]*>\s*DDE(AUTO)?\b/i.test(xml) || /w:instr="\s*DDE(AUTO)?\b/i.test(xml)) {
        throw dangerous('Word document contains DDE fields and is not allowed');
      }
    }
    return MIME.DOCX;
  }
  if (ct.includes('spreadsheetml.sheet.main+xml')) return MIME.XLSX;
  throw unsupported('Only .docx and .xlsx Office files are accepted');
}

// Reads the ZIP central directory without extracting anything to disk.
function zipEntries(buf) {
  const damaged = () => unsupported('File is damaged or not a valid Office document');

  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw damaged();

  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || offset === 0xffffffff) throw unsupported('ZIP64 Office files are not supported');
  if (count > MAX_ZIP_ENTRIES) throw dangerous('Office file has too many parts');

  const entries = [];
  for (let n = 0; n < count; n++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50) throw damaged();
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    if (offset + 46 + nameLen > buf.length) throw damaged();
    entries.push({
      name:        buf.toString('utf8', offset + 46, offset + 46 + nameLen),
      method:      buf.readUInt16LE(offset + 10),
      compSize:    buf.readUInt32LE(offset + 20),
      size:        buf.readUInt32LE(offset + 24),
      localOffset: buf.readUInt32LE(offset + 42),
    });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntry(buf, entry, maxBytes) {
  const lo = entry.localOffset;
  if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== 0x04034b50) {
    throw unsupported('File is damaged or not a valid Office document');
  }
  const start = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
  const data = buf.subarray(start, start + entry.compSize);
  try {
    if (entry.method === 0) return data;
    if (entry.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: maxBytes });
  } catch (err) {
    if (err.code === 'ERR_BUFFER_TOO_LARGE') throw dangerous('Office file part is too large to check');
    throw unsupported('File is damaged or not a valid Office document');
  }
  throw unsupported('Office file uses an unsupported compression method');
}

// ── CSV ────────────────────────────────────────────────────────────────────
// Must be plain text, and no cell may start like a formula: Excel runs those
// on open (CSV / formula injection, e.g. =HYPERLINK(...) or =cmd|' /C calc'!A0).
// Numbers like -42 or phone numbers like +91 98765 43210 are fine.
const FORMULA_START = new Set(['=', '+', '-', '@', '\t', '\r', '＝', '＋', '－', '＠']);
// A lone "-" (common "no value" placeholder) is harmless too.
const SIGNED_NUMBER = /^(?:[+\-＋－][\d\s().,\-]*\d[\d\s().,\-]*|-)$/;

function checkCsv(buf) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    text = buf.toString('latin1');   // Excel's default "CSV" on Windows is ANSI, not UTF-8
  }
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(text)) {
    throw unsupported('CSV must be plain text (binary content found)');
  }

  const bad = findFormulaCell(text.replace(/^﻿/, ''));
  if (bad) {
    throw dangerous(`CSV row ${bad.row} has a cell starting with "${bad.value.slice(0, 20)}". ` +
      'Cells that start like a formula (= + - @) are not allowed');
  }
}

function findFormulaCell(text) {
  let row = 1;
  let atCellStart = true;
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') i++;
        else inQuotes = false;
      } else if (c === '\n') {
        row++;
      }
      continue;
    }
    if (atCellStart) {
      atCellStart = false;
      const quoted = c === '"';
      const start = quoted ? i + 1 : i;
      const value = quoted
        ? text.slice(start, text.indexOf('"', start) === -1 ? undefined : text.indexOf('"', start))
        : text.slice(start).match(/^[^,\r\n]*/)[0];
      const first = text[start];
      const isLineEnd = first === '\r' && text[start + 1] === '\n';
      if (FORMULA_START.has(first) && !isLineEnd && !SIGNED_NUMBER.test(value.trimEnd())) {
        return { row, value };
      }
      if (quoted) { inQuotes = true; continue; }
    }
    if (c === ',') atCellStart = true;
    else if (c === '\n') { atCellStart = true; row++; }
  }
  return null;
}

module.exports = { inspectFile };
