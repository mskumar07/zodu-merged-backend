// Finds printers the POS could use, so nobody has to type an IP address or a
// driver name:
//   - LAN: every host on this PC's local /24 networks with raw port 9100 open,
//     plus printers installed with a TCP/IP port;
//   - USB: printers installed on a USB port;
//   - Bluetooth: paired Bluetooth serial (COM) ports, and printers installed on one.

const net = require("net");
const os = require("os");
const { execFile } = require("child_process");

const RAW_PORT = 9100;
const PROBE_TIMEOUT_MS = 600;
const PROBE_CONCURRENCY = 96;

// Windows' virtual printers — never a thermal printer.
const VIRTUAL_PORT = /^(PORTPROMPT:|nul:|SHRFAX:|FILE:|XPSPort:|OneNote|Microsoft\.Office|WSD-|PDF)/i;
const VIRTUAL_NAME = /(PDF|XPS|OneNote|Fax|Send To)/i;

function run(cmd, args, timeout = 20000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? "" : stdout.toString());
    });
  });
}

function powershellJson(script) {
  return run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `${script} | ConvertTo-Json -Compress`])
    .then((out) => {
      if (!out.trim()) return [];
      try {
        const parsed = JSON.parse(out);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return [];
      }
    });
}

/** The /24 networks of this PC's active IPv4 interfaces, as base addresses like "192.168.1". */
function localSubnets() {
  const bases = new Map();
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== "IPv4" && a.family !== 4) continue;
      if (a.internal || a.address.startsWith("169.254.")) continue;
      const parts = a.address.split(".");
      bases.set(parts.slice(0, 3).join("."), a.address);
    }
  }
  return [...bases.entries()].map(([base, self]) => ({ base, self }));
}

function probe(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (open) => { socket.destroy(); resolve(open); };
    socket.setTimeout(PROBE_TIMEOUT_MS, () => done(false));
    socket.once("error", () => done(false));
    socket.once("connect", () => done(true));
  });
}

async function scanLan() {
  const hosts = [];
  for (const { base, self } of localSubnets()) {
    for (let i = 1; i < 255; i++) {
      const ip = `${base}.${i}`;
      if (ip !== self) hosts.push(ip);
    }
  }
  const found = [];
  let next = 0;
  const worker = async () => {
    while (next < hosts.length) {
      const ip = hosts[next++];
      if (await probe(ip, RAW_PORT)) found.push(ip);
    }
  };
  await Promise.all(Array.from({ length: PROBE_CONCURRENCY }, worker));
  return found;
}

async function windowsInstalled() {
  const [printers, ports, serial, btDevices] = await Promise.all([
    powershellJson("Get-Printer | Select-Object Name, PortName, DriverName"),
    powershellJson("Get-PrinterPort | Select-Object Name, PrinterHostAddress, PortNumber"),
    powershellJson("Get-CimInstance Win32_PnPEntity -Filter \"Name LIKE '%(COM%)'\" | Select-Object Name, DeviceID"),
    powershellJson("Get-CimInstance Win32_PnPEntity -Filter \"DeviceID LIKE 'BTHENUM\\\\DEV_%'\" | Select-Object Name, DeviceID"),
  ]);
  // Paired Bluetooth devices by MAC, to name the COM port each one created.
  const btNameByMac = new Map();
  for (const d of btDevices) {
    const mac = /DEV_([0-9A-F]{12})/i.exec(String(d.DeviceID || ""));
    if (mac && d.Name) btNameByMac.set(mac[1].toUpperCase(), d.Name);
  }
  const portByName = new Map(ports.map((p) => [p.Name, p]));
  const results = [];

  for (const p of printers) {
    const portName = String(p.PortName || "");
    if (!p.Name || VIRTUAL_PORT.test(portName) || VIRTUAL_NAME.test(p.Name)) continue;
    const port = portByName.get(portName);
    if (port && port.PrinterHostAddress) {
      results.push({
        connection_type: "LAN", name: p.Name, ip_address: port.PrinterHostAddress,
        port: Number(port.PortNumber) || RAW_PORT, device_name: null, detail: `Installed · ${p.DriverName || portName}`,
      });
    } else if (/^USB/i.test(portName)) {
      results.push({ connection_type: "USB", name: p.Name, ip_address: null, port: null, device_name: p.Name, detail: `USB · ${p.DriverName || portName}` });
    } else if (/^(COM\d+|BTH)/i.test(portName)) {
      results.push({ connection_type: "BLUETOOTH", name: p.Name, ip_address: null, port: null, device_name: p.Name, detail: `Bluetooth · ${portName}` });
    }
  }

  for (const s of serial) {
    const m = /^(.*)\((COM\d+)\)\s*$/i.exec(String(s.Name || ""));
    if (!m || !/bluetooth/i.test(m[1])) continue;
    // The DeviceID ends in the remote device's MAC; all zeros is an incoming port nothing can print to.
    const mac = /&([0-9A-F]{12})_/i.exec(String(s.DeviceID || ""));
    if (!mac || /^0{12}$/.test(mac[1])) continue;
    const com = m[2].toUpperCase();
    const device = btNameByMac.get(mac[1].toUpperCase());
    results.push({
      connection_type: "BLUETOOTH", name: device || com, ip_address: null, port: null, device_name: com,
      detail: `Bluetooth · ${com}`,
    });
  }
  return results;
}

async function cupsInstalled() {
  const out = await run("lpstat", ["-v"]);
  const results = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^device for (.+?):\s*(\S+)/.exec(line.trim());
    if (!m) continue;
    const [, name, uri] = m;
    const host = /^(?:socket|ipp|http|lpd):\/\/([^:/]+)(?::(\d+))?/i.exec(uri);
    if (host) {
      results.push({ connection_type: "LAN", name, ip_address: host[1], port: uri.startsWith("socket") ? Number(host[2]) || RAW_PORT : RAW_PORT, device_name: null, detail: `Installed · ${uri}` });
    } else if (/^usb:/i.test(uri)) {
      results.push({ connection_type: "USB", name, ip_address: null, port: null, device_name: name, detail: `USB · ${uri}` });
    } else if (/^(bluetooth|serial):/i.test(uri)) {
      results.push({ connection_type: "BLUETOOTH", name, ip_address: null, port: null, device_name: name, detail: uri });
    }
  }
  return results;
}

/** Everything found, de-duplicated (a LAN printer both installed and answering the scan is listed once). */
async function discoverPrinters() {
  const [installed, lanHosts] = await Promise.all([
    process.platform === "win32" ? windowsInstalled() : cupsInstalled(),
    scanLan(),
  ]);
  const results = [...installed];
  const seen = new Set(results.map((r) => (r.connection_type === "LAN" ? `LAN:${r.ip_address}:${r.port}` : `${r.connection_type}:${r.device_name}`)));
  for (const ip of lanHosts) {
    const key = `LAN:${ip}:${RAW_PORT}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ connection_type: "LAN", name: `Network printer ${ip}`, ip_address: ip, port: RAW_PORT, device_name: null, detail: `Answers on port ${RAW_PORT}` });
  }
  return results;
}

module.exports = { discoverPrinters };
