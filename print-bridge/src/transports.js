// How raw ESC/POS bytes reach a printer. The POS renders the ticket; the bridge
// only moves the bytes, so a template change never needs a bridge update.

const net = require("net");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

const LAN_TIMEOUT_MS = 5000;

/** Raw TCP — the JetDirect/port-9100 socket every network thermal printer speaks. */
function sendLan(host, port, data) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };
    socket.setTimeout(LAN_TIMEOUT_MS, () => finish(new Error(`Printer ${host}:${port} did not respond`)));
    socket.once("error", (err) => finish(new Error(`Printer ${host}:${port} unreachable (${err.code || err.message})`)));
    socket.once("connect", () => {
      socket.end(data, () => finish());
    });
  });
}

// Windows has no command-line way to send RAW bytes to a spooled printer, so a
// few lines of C# call the winspool API directly (the classic RawPrinterHelper).
const WINDOWS_RAW_PRINT_PS1 = String.raw`
param([Parameter(Mandatory=$true)][string]$PrinterName, [Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class ZoduRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern int StartDocPrinter(IntPtr handle, int level, [In] DOCINFO doc);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool WritePrinter(IntPtr handle, byte[] bytes, int count, out int written);
  public static void Send(string printer, byte[] bytes) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("Printer not found: " + printer);
    try {
      var doc = new DOCINFO { pDocName = "Zodu KOT", pDataType = "RAW" };
      if (StartDocPrinter(h, 1, doc) == 0) throw new Exception("Could not start print job");
      StartPagePrinter(h);
      int written;
      bool ok = WritePrinter(h, bytes, bytes.Length, out written);
      EndPagePrinter(h);
      EndDocPrinter(h);
      if (!ok || written != bytes.Length) throw new Exception("Printer accepted only part of the job");
    } finally { ClosePrinter(h); }
  }
}
"@
try {
  [ZoduRawPrinter]::Send($PrinterName, [System.IO.File]::ReadAllBytes($Path))
} catch {
  # Report only the innermost reason ("Printer not found: ..."), not PowerShell's error record.
  $e = $_.Exception
  while ($e.InnerException) { $e = $e.InnerException }
  [Console]::Error.WriteLine($e.Message)
  exit 1
}
`;

let windowsScriptPath = null;
function windowsScript() {
  if (!windowsScriptPath) {
    windowsScriptPath = path.join(os.tmpdir(), "zodu-raw-print.ps1");
    fs.writeFileSync(windowsScriptPath, WINDOWS_RAW_PRINT_PS1, "utf8");
  }
  return windowsScriptPath;
}

function run(cmd, args, timeout = 20000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).toString().trim().split(/\r?\n/).slice(-1)[0]));
      else resolve(stdout.toString());
    });
  });
}

/** A printer installed in the OS (USB, or a paired Bluetooth printer with a driver). */
async function sendSpooler(printerName, data) {
  const tmp = path.join(os.tmpdir(), `zodu-kot-${process.pid}-${Date.now()}.bin`);
  fs.writeFileSync(tmp, data);
  try {
    if (process.platform === "win32") {
      await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-File", windowsScript(), "-PrinterName", printerName, "-Path", tmp]);
    } else {
      await run("lp", ["-d", printerName, "-o", "raw", tmp]);
    }
  } finally {
    fs.rm(tmp, { force: true }, () => {});
  }
}

/** A serial port — how Bluetooth SPP printers appear (COM5 on Windows, /dev/rfcomm0 on Linux). */
function sendSerial(port, data) {
  const device = process.platform === "win32" && /^COM\d+$/i.test(port) ? `\\\\.\\${port.toUpperCase()}` : port;
  return new Promise((resolve, reject) => {
    fs.writeFile(device, data, (err) => (err ? reject(new Error(`Could not write to ${port} (${err.code || err.message})`)) : resolve()));
  });
}

const isSerialPort = (name) => /^COM\d+$/i.test(name) || name.startsWith("/dev/");

async function sendToPrinter(printer, data) {
  const type = String(printer.connection_type || "").toUpperCase();
  if (type === "LAN") {
    if (!printer.ip_address) throw new Error("LAN printer has no IP address");
    return sendLan(printer.ip_address, Number(printer.port) || 9100, data);
  }
  if (type === "USB" || type === "BLUETOOTH") {
    const name = String(printer.device_name || "").trim();
    if (!name) throw new Error(`${type} printer has no device name`);
    return isSerialPort(name) ? sendSerial(name, data) : sendSpooler(name, data);
  }
  throw new Error(`Unsupported connection type: ${printer.connection_type}`);
}

/** Printers installed on this machine, for the settings screen's device picker. */
async function listSystemPrinters() {
  try {
    if (process.platform === "win32") {
      const out = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        "Get-Printer | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress"]);
      const parsed = out.trim() ? JSON.parse(out) : [];
      return Array.isArray(parsed) ? parsed : [parsed];
    }
    const out = await run("lpstat", ["-e"]);
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

module.exports = { sendToPrinter, listSystemPrinters };
