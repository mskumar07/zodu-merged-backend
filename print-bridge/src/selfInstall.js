// Self-install bootstrap for the packaged .exe only (`process.pkg` is a
// global pkg injects at runtime, never present under plain `node
// src/server.js`). Lets one file double as both the download and the
// installer: the first time a client runs the exe — from Downloads, a USB
// stick, wherever — it shows a real Windows install dialog (path field,
// Browse button, Install/Cancel), copies itself into the chosen location,
// sets up silent autostart, launches that copy, and exits. Re-running a
// newer exe later just re-installs the same way. Plain dev usage (`npm
// start`) never reaches any of this.
//
// The GUI is a WinForms dialog run through PowerShell rather than a bundled
// GUI toolkit: PowerShell + .NET WinForms already ship with every Windows
// install, so this stays a single ~37MB exe instead of pulling in Electron
// or a native compiler toolchain just to draw one dialog.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const APP_NAME = "Zodu Print Bridge";
const DEFAULT_INSTALL_DIR = path.join(os.homedir(), "AppData", "Local", "ZoduPrintBridge");
const MARKER_FILE = ".zodu-print-bridge-installed";
const STARTUP_DIR = path.join(
  os.homedir(), "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Startup"
);

// A copy is "installed" if it's running from a folder that has already been
// through install() below — checked by marker file rather than a hardcoded
// path, since the user can pick any install folder in the dialog.
const isInstalledCopy = () =>
  fs.existsSync(path.join(path.dirname(process.execPath), MARKER_FILE));

function psQuote(str) {
  return String(str).replace(/'/g, "''");
}

// Runs a WinForms script through PowerShell with its own console window
// hidden (the dialog itself is a separate GUI window, unaffected). Returns
// { stdout, status }.
function runGui(script) {
  return spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-STA", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-Command", script],
    { encoding: "utf8" }
  );
}

function showMessage(text, { title = APP_NAME, isError = false } = {}) {
  const icon = isError ? "Error" : "Information";
  runGui(
    `Add-Type -AssemblyName System.Windows.Forms\n` +
    `[System.Windows.Forms.MessageBox]::Show('${psQuote(text)}', '${psQuote(title)}', ` +
    `[System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::${icon}) | Out-Null`
  );
}

// Shows the install dialog and returns the chosen folder, or null if the
// user cancelled.
function promptForInstallDir() {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = '${psQuote(APP_NAME)} Setup'
$form.Size = New-Object System.Drawing.Size(480, 210)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.Topmost = $true

$label = New-Object System.Windows.Forms.Label
$label.Text = 'This will install ${psQuote(APP_NAME)} so it can print kitchen tickets.'
$label.Location = New-Object System.Drawing.Point(20, 15)
$label.Size = New-Object System.Drawing.Size(430, 20)
$form.Controls.Add($label)

$pathLabel = New-Object System.Windows.Forms.Label
$pathLabel.Text = 'Install folder:'
$pathLabel.Location = New-Object System.Drawing.Point(20, 50)
$pathLabel.Size = New-Object System.Drawing.Size(100, 20)
$form.Controls.Add($pathLabel)

$textbox = New-Object System.Windows.Forms.TextBox
$textbox.Text = '${psQuote(DEFAULT_INSTALL_DIR)}'
$textbox.Location = New-Object System.Drawing.Point(20, 72)
$textbox.Size = New-Object System.Drawing.Size(345, 24)
$form.Controls.Add($textbox)

$browseButton = New-Object System.Windows.Forms.Button
$browseButton.Text = 'Browse...'
$browseButton.Location = New-Object System.Drawing.Point(373, 71)
$browseButton.Size = New-Object System.Drawing.Size(75, 25)
$browseButton.Add_Click({
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = 'Choose a folder for ${psQuote(APP_NAME)}'
    if (Test-Path $textbox.Text) { $dialog.SelectedPath = $textbox.Text }
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        $textbox.Text = $dialog.SelectedPath
    }
})
$form.Controls.Add($browseButton)

$note = New-Object System.Windows.Forms.Label
$note.Text = 'It will run quietly in the background and start automatically at login.'
$note.Location = New-Object System.Drawing.Point(20, 105)
$note.Size = New-Object System.Drawing.Size(430, 32)
$note.ForeColor = [System.Drawing.Color]::DimGray
$form.Controls.Add($note)

$installButton = New-Object System.Windows.Forms.Button
$installButton.Text = 'Install'
$installButton.Location = New-Object System.Drawing.Point(288, 138)
$installButton.Size = New-Object System.Drawing.Size(80, 28)
$installButton.DialogResult = [System.Windows.Forms.DialogResult]::OK
$form.Controls.Add($installButton)
$form.AcceptButton = $installButton

$cancelButton = New-Object System.Windows.Forms.Button
$cancelButton.Text = 'Cancel'
$cancelButton.Location = New-Object System.Drawing.Point(373, 138)
$cancelButton.Size = New-Object System.Drawing.Size(75, 28)
$cancelButton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$form.Controls.Add($cancelButton)
$form.CancelButton = $cancelButton

$result = $form.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output "PATH:$($textbox.Text)"
} else {
    Write-Output 'CANCELLED'
}
`;

  const result = runGui(script);
  const out = (result.stdout || "").trim();
  if (!out || out === "CANCELLED" || !out.startsWith("PATH:")) return null;
  return out.slice("PATH:".length).trim();
}

function install() {
  const installDir = promptForInstallDir();
  if (!installDir) {
    process.exit(0); // user cancelled — no message needed, matches normal installer UX
  }

  const installedExe = path.join(installDir, "ZoduPrintBridge.exe");

  try {
    fs.mkdirSync(installDir, { recursive: true });
    // Reads the currently-running exe's own bytes — a plain read, so this is
    // safe even though the file is "in use" by this very process.
    fs.copyFileSync(process.execPath, installedExe);
    fs.writeFileSync(
      path.join(installDir, MARKER_FILE),
      JSON.stringify({ installedAt: new Date().toISOString() }, null, 2)
    );

    // A visible console window flashing at every Windows login would alarm a
    // non-technical user, so autostart launches through a tiny hidden-window
    // VBScript instead of the exe directly.
    const vbsPath = path.join(installDir, "run-hidden.vbs");
    fs.writeFileSync(
      vbsPath,
      `Set WshShell = CreateObject("WScript.Shell")\r\n` +
      `WshShell.Run """${installedExe}""", 0, False\r\n`
    );

    const shortcutPath = path.join(STARTUP_DIR, `${APP_NAME}.lnk`);
    const makeShortcut = [
      `$WshShell = New-Object -ComObject WScript.Shell`,
      `$Shortcut = $WshShell.CreateShortcut('${psQuote(shortcutPath)}')`,
      `$Shortcut.TargetPath = 'wscript.exe'`,
      `$Shortcut.Arguments = '"${psQuote(vbsPath)}"'`,
      `$Shortcut.WorkingDirectory = '${psQuote(installDir)}'`,
      `$Shortcut.Description = '${psQuote(APP_NAME)}'`,
      `$Shortcut.Save()`,
    ].join("; ");
    const shortcutResult = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-Command", makeShortcut],
      { stdio: "pipe", encoding: "utf8" }
    );
    if (shortcutResult.status !== 0) {
      throw new Error(`could not set up autostart (${(shortcutResult.stderr || "").trim() || "unknown error"})`);
    }

    // Launch the installed copy now, the same hidden way autostart will —
    // so no console window flashes for whoever ran the installer either.
    spawnSync("wscript.exe", [vbsPath], { stdio: "ignore" });

    showMessage(
      `${APP_NAME} is installed and running.\n\n` +
      `Installed to:\n${installDir}\n\n` +
      `It will start automatically whenever you log in to Windows.\n\n` +
      `Next: in Zodu, go to Settings -> KOT printers and confirm it shows "Connected".`
    );
  } catch (err) {
    showMessage(`Install failed: ${err.message}`, { title: `${APP_NAME} — Setup failed`, isError: true });
    process.exit(1);
  }
  process.exit(0);
}

// Call before starting the HTTP server. If this is a freshly-downloaded exe,
// runs the install dialog and exits — server startup is never reached in
// that case. If this already IS the installed copy (double-clicked directly,
// or launched hidden by the Startup shortcut), does nothing so the caller
// starts the server normally.
function bootstrap() {
  if (!process.pkg) return;
  if (process.platform !== "win32") return;
  if (isInstalledCopy()) return;
  install();
}

module.exports = { bootstrap };
