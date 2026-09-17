# Zodu Print Bridge

A small local service that lets the Zodu restaurant POS print KOTs directly to
kitchen printers. A web page can't open a socket to a printer or pick a printer
itself, so the POS sends each ticket (already rendered as ESC/POS bytes) to this
bridge on the billing PC, and the bridge sends it to the printer.

```
POS (browser) ──HTTP──► Print Bridge (127.0.0.1:9123) ──► LAN printer (TCP 9100)
                                                     ├──► USB printer (Windows spooler / CUPS)
                                                     └──► Bluetooth printer (COM port / spooler)
```

No npm dependencies. Needs Node.js 18 or newer — unless you use the exe below,
which needs nothing at all.

## Install on the billing PC (recommended — give the client this)

Send the client **`dist/ZoduPrintBridge.exe`** (built per
[Building the exe](#building-the-exe) below) — one file, nothing else needed.
No Node.js, no command line, no admin rights.

Double-click it. The first time it runs anywhere other than its installed
location, a normal-looking Windows install dialog appears — an install
folder field (defaults to `%LOCALAPPDATA%\ZoduPrintBridge`, editable, with a
**Browse...** button), and **Install** / **Cancel** buttons. Clicking
**Install**:
- copies itself to the chosen folder,
- sets that copy to start silently (no console window) whenever the client
  logs in to Windows, via a shortcut in their Startup folder,
- starts it immediately,
- shows a confirmation dialog with the install path, then exits.

From then on the installed copy is what actually runs (directly, or hidden
via the Startup shortcut) — it recognizes it's already in place (by a small
marker file dropped next to it at install time) and just starts the server;
it never shows the install dialog again or re-installs in a loop. In Zodu,
go to **Settings → KOT printers** and check that the bridge shows
**Connected**.

The dialog is a real Windows Forms window drawn via PowerShell (which, like
.NET WinForms, already ships with every Windows install) rather than a
bundled GUI toolkit — that's what keeps this a single ~37MB exe instead of
pulling in Electron just to draw one screen.

To update to a newer version, send the client the new exe and have them
double-click it the same way — it overwrites the installed copy in place.

## Manual install (for development, or if you'd rather not use the exe)

1. Install Node.js LTS from https://nodejs.org.
2. Copy this `print-bridge` folder to the PC, e.g. `C:\ZoduPrintBridge`.
3. Start it:
   ```
   cd C:\ZoduPrintBridge
   npm start
   ```
   It prints `Zodu Print Bridge 1.1.0 listening on http://127.0.0.1:9123`.
4. In Zodu, go to **Settings → KOT printers** and check that the bridge shows
   **Connected**.

### Start automatically with Windows

Create a scheduled task that runs at logon:

```
schtasks /Create /TN "Zodu Print Bridge" /SC ONLOGON /RL LIMITED ^
  /TR "cmd /c cd /d C:\ZoduPrintBridge && node src\server.js >> bridge.log 2>&1"
```

## Building the exe

Requires Node.js on the *build* machine only (the client never needs it).
From `print-bridge/`:

```
npm run build:exe
```

Bundles `src/server.js` (and its self-install logic in `src/selfInstall.js`)
into a standalone `dist/ZoduPrintBridge.exe` via `pkg` — self-contained, no
Node.js needed to run it. `dist/` isn't committed to git — rebuild it
whenever `src/` changes, before handing a new exe to a client.

`src/selfInstall.js`'s self-install/autostart logic only ever runs inside the
packaged exe (gated on pkg's `process.pkg` global) — `npm start` in dev
always just starts the server directly, untouched.

## Setting up printers

The quickest way: **Settings → KOT printers → Auto detect**. The bridge finds
- network printers — every device on this PC's local network (/24) answering on
  port 9100, plus printers installed in Windows with a TCP/IP port;
- USB printers installed in Windows;
- paired Bluetooth devices' outgoing COM ports, named after the paired device
  (headphones and phones show up too; likely printers are listed first).

Press **Add** next to one to open the printer form already filled in. Only
networks this PC is on are scanned, so a printer on another VLAN or a guest
Wi-Fi must still be added by hand.

To add one manually, **Settings → KOT printers → Add printer**:

| Connection | What to enter |
|---|---|
| LAN | The printer's IP address and port (almost always `9100`). Give the printer a fixed IP on the router so it doesn't change. |
| USB | The printer's name exactly as it appears in Windows **Printers & scanners** (the dialog lists this PC's printers when the bridge is running). Install the printer's Windows driver first. |
| Bluetooth | Pair the printer in Windows. Enter its outgoing **COM port** (e.g. `COM5`, under *More Bluetooth settings → COM Ports*), or its printer name if it was installed as a printer. |

Use **Test print** next to each printer to confirm it prints.

## How tickets print

- Each counter's KOT goes to that counter's printer. If it fails (after the
  retries set in Settings), its items are sent to each item's fallback counter's
  printer, or the billing printer, with a **REROUTED** banner.
- Every attempt is recorded in the KOT print log. A ticket that could not be
  printed shows a warning on the POS with a **Reprint** button, and every
  order's tickets can be reprinted from the kitchen-tickets button in the POS
  header.
- Item names in Tamil, Hindi or other non-Latin scripts are printed as an image,
  because thermal printers' built-in fonts don't include them.

## Configuration

Environment variables (all optional):

| Variable | Default | Purpose |
|---|---|---|
| `BRIDGE_PORT` | `9123` | Port to listen on. If you change it, update the bridge address in Settings → KOT printers on this PC. |
| `BRIDGE_HOST` | `127.0.0.1` | Interface to listen on. Keep the default — the bridge is for this PC only. |
| `BRIDGE_ALLOWED_ORIGINS` | *(none)* | Extra web origins allowed to print, comma-separated. `*.zodu.in`, `*.myzodu.com` and `localhost` are always allowed. |

## Troubleshooting

- **Settings shows "Not running"** — the bridge isn't started, or is on another
  port. Start it and press *Save & test*. Chrome may ask to allow the site to
  access devices on your local network; allow it.
- **"Printer … unreachable"** — the PC can't reach the printer's IP. Check the
  printer is on and on the same network (print its self-test page to see its IP).
- **"Printer not found: …"** (USB) — the name doesn't match the installed
  printer's name exactly.
- **Garbled output** — the printer isn't in ESC/POS mode; most thermal printers
  are by default.

## API

| Method | Path | Body / response |
|---|---|---|
| `GET` | `/health` | `{ ok: true, version }` |
| `GET` | `/printers` | `{ ok: true, printers: ["EPSON TM-T82", …] }` |
| `GET` | `/discover` | `{ ok: true, printers: [{ connection_type, name, ip_address, port, device_name, detail }] }` — takes a few seconds (network scan) |
| `POST` | `/print` | `{ printer: { connection_type, ip_address, port, device_name }, data: "<base64 ESC/POS>" }` → `{ ok: true }` or `{ ok: false, error }` |

Jobs to the same printer are queued so tickets never interleave on the paper.
