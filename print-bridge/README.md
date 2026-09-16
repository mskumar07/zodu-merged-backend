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

No npm dependencies. Needs Node.js 18 or newer.

## Install on the billing PC

1. Install Node.js LTS from https://nodejs.org.
2. Copy this `print-bridge` folder to the PC, e.g. `C:\ZoduPrintBridge`.
3. Start it:
   ```
   cd C:\ZoduPrintBridge
   npm start
   ```
   It prints `Zodu Print Bridge 1.0.0 listening on http://127.0.0.1:9123`.
4. In Zodu, go to **Settings → KOT printers** and check that the bridge shows
   **Connected**.

### Start automatically with Windows

Create a scheduled task that runs at logon:

```
schtasks /Create /TN "Zodu Print Bridge" /SC ONLOGON /RL LIMITED ^
  /TR "cmd /c cd /d C:\ZoduPrintBridge && node src\server.js >> bridge.log 2>&1"
```

## Setting up printers

In **Settings → KOT printers → Add printer**:

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
| `POST` | `/print` | `{ printer: { connection_type, ip_address, port, device_name }, data: "<base64 ESC/POS>" }` → `{ ok: true }` or `{ ok: false, error }` |

Jobs to the same printer are queued so tickets never interleave on the paper.
