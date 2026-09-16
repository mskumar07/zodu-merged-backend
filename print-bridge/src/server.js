// Zodu Print Bridge — runs on the restaurant's billing PC and lets the POS in
// the browser print KOTs straight to kitchen printers, which a web page cannot
// reach on its own.
//
//   GET  /health     → { ok, version }
//   GET  /printers   → { ok, printers: [name, ...] }   installed OS printers
//   POST /print      → { printer: {connection_type, ip_address, port, device_name}, data: <base64 ESC/POS> }

const http = require("http");
const { sendToPrinter, listSystemPrinters } = require("./transports");
const { version } = require("../package.json");

const HOST = process.env.BRIDGE_HOST || "127.0.0.1";
const PORT = Number(process.env.BRIDGE_PORT) || 9123;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

// Any page the browser opens could call a localhost port, so only the Zodu web
// app (and local development) may print. Extra origins: BRIDGE_ALLOWED_ORIGINS,
// comma-separated.
const DEFAULT_ORIGIN_PATTERNS = [
  /^https:\/\/([a-z0-9-]+\.)*zodu\.in$/i,
  /^https:\/\/([a-z0-9-]+\.)*myzodu\.com$/i,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i,
];
const EXTRA_ORIGINS = (process.env.BRIDGE_ALLOWED_ORIGINS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

function originAllowed(origin) {
  if (!origin) return true; // curl / same-machine tools send none; browsers always do
  return EXTRA_ORIGINS.includes(origin) || DEFAULT_ORIGIN_PATTERNS.some((re) => re.test(origin));
}

function send(res, status, body, origin) {
  const headers = { "Content-Type": "application/json" };
  if (origin && originAllowed(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Print job too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(Object.assign(new Error("Invalid JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

// One job at a time per printer: two tickets written to the same socket or
// spooler at once can interleave on the paper.
const printerQueues = new Map();
function enqueue(key, job) {
  const previous = printerQueues.get(key) || Promise.resolve();
  const next = previous.then(job);
  // The queue tail swallows the job's failure — the caller gets it from `next` —
  // so one failed job neither blocks the next nor crashes the process as an
  // unhandled rejection.
  const tail = next.then(() => {}, () => {}).then(() => {
    if (printerQueues.get(key) === tail) printerQueues.delete(key);
  });
  printerQueues.set(key, tail);
  return next;
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;

  if (!originAllowed(origin)) {
    return send(res, 403, { ok: false, error: "Origin not allowed" });
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": origin || "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      // Chrome's Private Network Access preflight for a public page calling localhost.
      "Access-Control-Allow-Private-Network": "true",
      "Access-Control-Max-Age": "600",
      "Vary": "Origin",
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, { ok: true, version }, origin);
    }

    if (req.method === "GET" && url.pathname === "/printers") {
      return send(res, 200, { ok: true, printers: await listSystemPrinters() }, origin);
    }

    if (req.method === "POST" && url.pathname === "/print") {
      const body = await readJson(req);
      const printer = body.printer || {};
      if (typeof body.data !== "string" || !body.data) {
        return send(res, 400, { ok: false, error: "Missing print data" }, origin);
      }
      const data = Buffer.from(body.data, "base64");
      const key = `${printer.connection_type}:${printer.ip_address || ""}:${printer.port || ""}:${printer.device_name || ""}`;
      const started = Date.now();
      await enqueue(key, () => sendToPrinter(printer, data));
      console.log(`[print] ${key} ${data.length} bytes in ${Date.now() - started} ms`);
      return send(res, 200, { ok: true }, origin);
    }

    return send(res, 404, { ok: false, error: "Not found" }, origin);
  } catch (err) {
    console.error(`[error] ${req.method} ${url.pathname}: ${err.message}`);
    return send(res, err.status || 502, { ok: false, error: err.message }, origin);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Zodu Print Bridge ${version} listening on http://${HOST}:${PORT}`);
});
