// Headers for a response that carries a file (not JSON).
//
// The apps show these files in <img>, <iframe> and <embed> from their own
// origins (web, Electron, invoice previews), so a file response:
//   - may be loaded cross-origin (Cross-Origin-Resource-Policy: cross-origin)
//   - may be framed: no X-Frame-Options; with FRAME_ANCESTORS set, only by those origins
//   - still can't run as a page: CSP sandbox, except PDFs, which Chrome's viewer
//     won't open in a sandbox (PDFs are checked for scripts on upload)

function fileResponseHeaders(res, type, frameAncestors = []) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.removeHeader('X-Frame-Options');
  const frame = frameAncestors.length ? `frame-ancestors ${frameAncestors.join(' ')}` : '';
  if (type === 'application/pdf') {
    if (frame) res.setHeader('Content-Security-Policy', frame);
    else res.removeHeader('Content-Security-Policy');
  } else {
    res.setHeader('Content-Security-Policy', ["default-src 'none'", 'sandbox', frame].filter(Boolean).join('; '));
  }
}

module.exports = { fileResponseHeaders };
