// Runs without MinIO: npm test
const test   = require('node:test');
const assert = require('node:assert/strict');
const zlib   = require('zlib');
const { inspectFile } = require('../src/storage/file-inspector');
const { MIME } = require('../src/storage/modules');

// ── sample builders ────────────────────────────────────────────────────────
const PNG  = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
const pdf  = (body = '') => Buffer.from(`%PDF-1.4\n1 0 obj<<${body}>>endobj\ntrailer<<>>\n%%EOF\n`);

// Minimal ZIP writer (deflate), enough to produce real .docx / .xlsx files.
function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content);
    const data = zlib.deflateRawSync(raw);
    const nameBuf = Buffer.from(name);
    const crc = zlib.crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);

    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const ct = (main) => `<?xml version="1.0"?><Types><Override PartName="/x" ContentType="${main}"/></Types>`;
const DOCX_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const XLSX_CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
const docx = (extra = {}, body = '<w:p>Hello</w:p>') =>
  zip({ '[Content_Types].xml': ct(DOCX_CT), 'word/document.xml': `<w:document>${body}</w:document>`, ...extra });
const xlsx = (extra = {}) => zip({ '[Content_Types].xml': ct(XLSX_CT), 'xl/workbook.xml': '<workbook/>', ...extra });

// Legacy OLE compound file with the given UTF-16LE directory names.
const ole = (...names) => Buffer.concat([
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504),
  ...names.map((n) => Buffer.from(n, 'utf16le')),
]);
const csv = (s) => Buffer.from(s);

const rejects = (buf, name, status, re) =>
  assert.throws(() => inspectFile(buf, name), (e) => e.status === status && (!re || re.test(e.message)));

// ── accepted ───────────────────────────────────────────────────────────────
test('detects every allowed type from its bytes', () => {
  assert.equal(inspectFile(PNG, 'a.png').mime, MIME.PNG);
  assert.equal(inspectFile(JPEG, 'a.JPEG').mime, MIME.JPEG);
  assert.equal(inspectFile(WEBP, 'a.webp').mime, MIME.WEBP);
  assert.equal(inspectFile(pdf('/Type/Catalog'), 'a.pdf').mime, MIME.PDF);
  assert.equal(inspectFile(ole('Root Entry', 'WordDocument'), 'a.doc').mime, MIME.DOC);
  assert.equal(inspectFile(docx(), 'report.docx').mime, MIME.DOCX);
  assert.equal(inspectFile(xlsx(), 'sheet.xlsx').mime, MIME.XLSX);
  assert.equal(inspectFile(csv('name,amount,phone\nTea,-42.50,+91 98765 43210\n"Milk, 1L","-1,234.50",-\n'), 'a.csv').mime, MIME.CSV);
});

test('CSV saved by Excel as ANSI (not UTF-8) is accepted', () => {
  assert.equal(inspectFile(Buffer.from('name\r\ncaf\xe9\r\n', 'latin1'), 'a.csv').mime, MIME.CSV);
});

// ── spoofing ───────────────────────────────────────────────────────────────
test('file name must match the real content', () => {
  rejects(PNG, 'invoice.pdf', 415, /content is PNG/);
  rejects(pdf(), 'photo.jpg', 415);
  rejects(docx(), 'sheet.xlsx', 415);
  rejects(PNG, 'noextension', 415);
});

test('scripts, executables and unknown formats are refused', () => {
  rejects(Buffer.from('<html><script>alert(1)</script></html>'), 'x.png', 415);
  rejects(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), 'x.svg', 415);
  rejects(Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)]), 'setup.pdf', 415);
  rejects(zip({ 'payload.exe': 'MZ' }), 'files.zip', 415);
  rejects(zip({ 'payload.exe': 'MZ' }), 'files.docx', 415);
  rejects(Buffer.alloc(0), 'empty.png', 400);
});

// ── PDF ────────────────────────────────────────────────────────────────────
test('PDF with JavaScript, launch actions or attachments is refused', () => {
  rejects(pdf('/OpenAction<</S/JavaScript/JS(app.alert(1))>>'), 'a.pdf', 422, /JavaScript/);
  rejects(pdf('/OpenAction<</S/J#61vaScript>>'), 'a.pdf', 422, /JavaScript/);   // hex-escaped name
  rejects(pdf('/A<</S/Launch/F(cmd.exe)>>'), 'a.pdf', 422, /Launch/);
  rejects(pdf('/Names<</EmbeddedFiles 2 0 R>>'), 'a.pdf', 422, /EmbeddedFiles/);
  rejects(pdf('/Encrypt 5 0 R'), 'a.pdf', 422, /Encrypted/);
});

test('PDF JavaScript hidden inside a compressed object stream is found', () => {
  const hidden = zlib.deflateSync(Buffer.from('<</S/JavaScript/JS(app.alert(1))>>'));
  const buf = Buffer.concat([
    Buffer.from('%PDF-1.5\n3 0 obj<</Type/ObjStm/Filter/FlateDecode/Length ' + hidden.length + '>>stream\n'),
    hidden,
    Buffer.from('\nendstream endobj\n%%EOF\n'),
  ]);
  rejects(buf, 'a.pdf', 422, /JavaScript/);
});

test('binary stream data does not cause false alarms', () => {
  const noise = Buffer.from('xx/JS xx /JavaScript xx', 'latin1');   // inside an image stream, not an action
  const buf = Buffer.concat([
    Buffer.from('%PDF-1.4\n4 0 obj<</Type/XObject/Subtype/Image/Length 23>>stream\n'),
    noise,
    Buffer.from('\nendstream endobj\n%%EOF\n'),
  ]);
  assert.equal(inspectFile(buf, 'scan.pdf').mime, MIME.PDF);
});

// ── Office ─────────────────────────────────────────────────────────────────
test('macros, ActiveX, embedded objects, external links and DDE are refused', () => {
  rejects(docx({ 'word/vbaProject.bin': 'x' }), 'a.docx', 422, /macros/);
  rejects(zip({ '[Content_Types].xml': ct('application/vnd.ms-word.document.macroEnabled.main+xml') }), 'a.docx', 422, /Macro/);
  rejects(xlsx({ 'xl/activeX/activeX1.bin': 'x' }), 'a.xlsx', 422, /ActiveX/);
  rejects(docx({ 'word/embeddings/oleObject1.bin': 'x' }), 'a.docx', 422, /embedded/);
  rejects(xlsx({ 'xl/externalLinks/externalLink1.xml': '<x/>' }), 'a.xlsx', 422, /external/);
  rejects(docx({}, '<w:r><w:instrText> DDEAUTO c:\\\\windows\\\\system32\\\\cmd.exe "/k calc"</w:instrText></w:r>'), 'a.docx', 422, /DDE/);
  rejects(docx({ '../../evil.txt': 'x' }), 'a.docx', 422, /unsafe paths/);
});

test('legacy .doc: only Word, never macros; old .xls is refused', () => {
  rejects(ole('Root Entry', 'WordDocument', 'Macros', '_VBA_PROJECT'), 'a.doc', 422, /macros/);
  rejects(ole('Root Entry', 'Workbook'), 'a.doc', 415, /xlsx/);
});

test('zip bomb is refused before anything is inflated', () => {
  const buf = xlsx();
  // Patch every central-directory entry to claim 150MB uncompressed.
  for (let i = 0; i < buf.length - 4; i++) {
    if (buf.readUInt32LE(i) === 0x02014b50) buf.writeUInt32LE(150 * 1024 * 1024, i + 24);
  }
  rejects(buf, 'a.xlsx', 422, /zip bomb/);
});

// ── CSV ────────────────────────────────────────────────────────────────────
test('CSV formula injection is refused', () => {
  rejects(csv('name,total\nx,=1+1\n'), 'a.csv', 422, /row 2/);
  rejects(csv('a\n"=HYPERLINK(""http://evil"")"\n'), 'a.csv', 422);
  rejects(csv("a\n@SUM(1)\n"), 'a.csv', 422);
  rejects(csv("a\n+cmd|' /C calc'!A0\n"), 'a.csv', 422);
  rejects(csv('a\n-2+3+cmd|calc\n'), 'a.csv', 422);
  rejects(csv('a\n\uFF1D1+1\n'), 'a.csv', 422);   // full-width "="
  rejects(csv('a\n\t=1\n'), 'a.csv', 422);
});

test('CSV with binary content is refused', () => {
  rejects(Buffer.from('a,b\n\x00\x01\x02\n', 'latin1'), 'a.csv', 415, /plain text/);
});
