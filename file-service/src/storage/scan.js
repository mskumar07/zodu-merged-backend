// Antivirus hook. Called for every file after inspection and transform, before
// anything is stored. A no-op today; plug ClamAV (clamd INSTREAM) in here.
//
// To reject a file, throw an error with status 422, e.g.
//   throw Object.assign(new Error('File failed the virus scan'), { status: 422 });

let scanner = async (_file) => {};

async function onScan(file) {
  await scanner(file);
}

// Tests and a future ClamAV adapter swap the implementation.
function setScanner(fn) {
  scanner = fn;
}

module.exports = { onScan, setScanner };
