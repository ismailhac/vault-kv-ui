import { writeFileSync, mkdirSync, existsSync, unlinkSync, chmodSync, copyFileSync, readFileSync } from 'fs'
import { execSync } from 'child_process'
import { platform, homedir } from 'os'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const nodeBin = process.execPath
const scriptPath = join(__dirname, 'vault-kv-ui.mjs')
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))
const VERSION = pkg.version
const HOME = homedir()
const PORT = process.env.BFF_PORT || '3001'
const APP_URL = `http://localhost:${PORT}`

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function tryRun(cmd) {
  try { execSync(cmd, { stdio: 'pipe' }); return true } catch { return false }
}

// ─── Linux ────────────────────────────────────────────────────────────────────

const SYSTEMD_DIR    = join(HOME, '.config', 'systemd', 'user')
const SYSTEMD_FILE   = join(SYSTEMD_DIR, 'vault-admin.service')
const DESKTOP_DIR    = join(HOME, '.local', 'share', 'applications')
const DESKTOP_FILE   = join(DESKTOP_DIR, 'vault-admin.desktop')
const LAUNCHER_FILE  = join(DESKTOP_DIR, 'vault-admin-launch.sh')
const ICONS_DIR      = join(HOME, '.local', 'share', 'icons', 'hicolor', 'scalable', 'apps')
const ICON_FILE      = join(ICONS_DIR, 'vault-admin.svg')
const FAVICON_SRC    = join(__dirname, '..', 'app', 'dist', 'favicon.svg')

function installLinux() {
  // systemd user service
  ensureDir(SYSTEMD_DIR)
  writeFileSync(SYSTEMD_FILE, [
    '[Unit]',
    `Description=Vault Admin v${VERSION} — HashiCorp Vault KV Web Console`,
    'After=network.target',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${nodeBin} ${scriptPath}`,
    'Restart=on-failure',
    'RestartSec=5',
    'Environment=VAULT_ADMIN_SERVICE=1',
    '',
    '[Install]',
    'WantedBy=default.target',
  ].join('\n') + '\n')
  console.log(`  ✓ systemd service  → ${SYSTEMD_FILE}`)

  tryRun('systemctl --user daemon-reload')
  if (tryRun('systemctl --user enable --now vault-admin')) {
    console.log('  ✓ Service enabled and started')
  } else {
    console.warn('  ⚠ Could not enable service automatically — run:')
    console.warn('    systemctl --user enable --now vault-admin')
  }

  // Icon
  ensureDir(ICONS_DIR)
  if (existsSync(FAVICON_SRC)) {
    copyFileSync(FAVICON_SRC, ICON_FILE)
    tryRun('gtk-update-icon-cache -f -t ~/.local/share/icons/hicolor')
  }

  // Launcher wrapper script (ensures service is up before opening browser)
  ensureDir(DESKTOP_DIR)
  writeFileSync(LAUNCHER_FILE, [
    '#!/bin/bash',
    `if ! curl -sf ${APP_URL} > /dev/null 2>&1; then`,
    '  systemctl --user start vault-admin 2>/dev/null &',
    '  sleep 1',
    'fi',
    `xdg-open ${APP_URL}`,
  ].join('\n') + '\n')
  chmodSync(LAUNCHER_FILE, 0o755)

  // .desktop entry
  const iconRef = existsSync(FAVICON_SRC) ? 'vault-admin' : 'preferences-system-network'
  writeFileSync(DESKTOP_FILE, [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Vault Admin',
    `Comment=HashiCorp Vault KV Web Console — v${VERSION}`,
    `Exec=${LAUNCHER_FILE}`,
    `Icon=${iconRef}`,
    'Terminal=false',
    'Categories=Development;Security;',
    'Keywords=vault;hashicorp;secrets;kv;',
  ].join('\n') + '\n')
  chmodSync(DESKTOP_FILE, 0o755)
  console.log(`  ✓ App launcher     → ${DESKTOP_FILE}`)
  tryRun(`update-desktop-database "${DESKTOP_DIR}"`)

  console.log(`\n  Vault Admin starts automatically at login.`)
  console.log(`  Open from your app launcher or: ${APP_URL}\n`)
}

function uninstallLinux() {
  tryRun('systemctl --user stop vault-admin')
  tryRun('systemctl --user disable vault-admin')
  tryRun('systemctl --user daemon-reload')
  for (const f of [SYSTEMD_FILE, DESKTOP_FILE, LAUNCHER_FILE, ICON_FILE]) {
    if (existsSync(f)) { unlinkSync(f); console.log(`  ✓ Removed ${f}`) }
  }
  tryRun(`update-desktop-database "${DESKTOP_DIR}"`)
  console.log('\n  Vault Admin service removed.\n')
}

// ─── macOS ────────────────────────────────────────────────────────────────────

const LAUNCH_AGENTS_DIR = join(HOME, 'Library', 'LaunchAgents')
const PLIST_FILE        = join(LAUNCH_AGENTS_DIR, 'com.vault-admin.plist')
const LOG_DIR           = join(HOME, '.vault-kv-ui')
const LOG_OUT           = join(LOG_DIR, 'vault-admin.log')
const LOG_ERR           = join(LOG_DIR, 'vault-admin-error.log')

function installMacos() {
  ensureDir(LAUNCH_AGENTS_DIR)
  ensureDir(LOG_DIR)
  writeFileSync(PLIST_FILE, [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    '  <string>com.vault-admin</string>',
    '  <key>ProgramArguments</key>',
    '  <array>',
    `    <string>${nodeBin}</string>`,
    `    <string>${scriptPath}</string>`,
    '  </array>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <true/>',
    '  <key>EnvironmentVariables</key>',
    '  <dict>',
    '    <key>VAULT_ADMIN_SERVICE</key>',
    '    <string>1</string>',
    '  </dict>',
    `  <key>StandardOutPath</key>`,
    `  <string>${LOG_OUT}</string>`,
    `  <key>StandardErrorPath</key>`,
    `  <string>${LOG_ERR}</string>`,
    '</dict>',
    '</plist>',
  ].join('\n') + '\n')
  console.log(`  ✓ Launch Agent     → ${PLIST_FILE}`)

  if (tryRun(`launchctl load "${PLIST_FILE}"`)) {
    console.log('  ✓ Launch Agent loaded and started')
  } else {
    console.warn('  ⚠ Could not load agent automatically — run:')
    console.warn(`    launchctl load "${PLIST_FILE}"`)
  }

  console.log(`\n  Vault Admin starts automatically at login.`)
  console.log(`  Open anytime: open ${APP_URL}`)
  console.log('  Tip: in Safari, drag the address bar to your Dock for a one-click launcher.\n')
}

function uninstallMacos() {
  if (existsSync(PLIST_FILE)) {
    tryRun(`launchctl unload "${PLIST_FILE}"`)
    unlinkSync(PLIST_FILE)
    console.log(`  ✓ Removed ${PLIST_FILE}`)
  }
  console.log('\n  Vault Admin service removed.\n')
}

// ─── Windows ─────────────────────────────────────────────────────────────────

const DESKTOP_WIN  = join(HOME, 'Desktop')
const STARTMENU    = join(HOME, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs')
const TASK_NAME    = 'VaultAdmin'

function installWindows() {
  // Task Scheduler — runs at logon, no terminal window
  const nodeEsc  = nodeBin.replace(/'/g, "''")
  const scriptEsc = scriptPath.replace(/\//g, '\\').replace(/'/g, "''")
  const ps = `
$action   = New-ScheduledTaskAction -Execute '${nodeEsc}' -Argument '"${scriptEsc}"'
$trigger  = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit 0 -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -Hidden $true
$principal= New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName '${TASK_NAME}' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName '${TASK_NAME}'
Write-Host 'ok'`.trim()

  let taskOk = false
  try {
    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${ps.replace(/"/g, '\\"')}"`, { stdio: 'pipe' })
    taskOk = true
    console.log('  ✓ Task Scheduler job created (starts automatically at login)')
  } catch {
    console.warn('  ⚠ Could not create Task Scheduler job (try running as administrator)')
    console.warn(`  Manual: add "${nodeBin}" "${scriptPath}" to your Startup folder`)
  }

  // Desktop shortcut (.url)
  if (existsSync(DESKTOP_WIN)) {
    const urlFile = join(DESKTOP_WIN, 'Vault Admin.url')
    writeFileSync(urlFile, `[InternetShortcut]\r\nURL=${APP_URL}\r\n`)
    console.log(`  ✓ Desktop shortcut → ${urlFile}`)
  }

  // Start Menu shortcut
  if (existsSync(STARTMENU)) {
    const smFile = join(STARTMENU, 'Vault Admin.url')
    writeFileSync(smFile, `[InternetShortcut]\r\nURL=${APP_URL}\r\n`)
    console.log(`  ✓ Start Menu entry → ${smFile}`)
  }

  console.log(`\n  Vault Admin ${taskOk ? 'starts automatically at login' : 'shortcuts created'}.`)
  console.log(`  Open from Desktop / Start Menu or: ${APP_URL}\n`)
}

function uninstallWindows() {
  const ps = `
Stop-ScheduledTask -TaskName '${TASK_NAME}' -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName '${TASK_NAME}' -Confirm:$false -ErrorAction SilentlyContinue
Write-Host 'ok'`.trim()
  try {
    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${ps.replace(/"/g, '\\"')}"`, { stdio: 'pipe' })
    console.log('  ✓ Task Scheduler job removed')
  } catch {
    console.warn('  ⚠ Could not remove task — remove "VaultAdmin" in Task Scheduler manually')
  }

  for (const dir of [DESKTOP_WIN, STARTMENU]) {
    const f = join(dir, 'Vault Admin.url')
    if (existsSync(f)) { unlinkSync(f); console.log(`  ✓ Removed ${f}`) }
  }
  console.log('\n  Vault Admin service removed.\n')
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function installService() {
  console.log('\n[Vault Admin] Installing background service...\n')
  const p = platform()
  if (p === 'linux') installLinux()
  else if (p === 'darwin') installMacos()
  else if (p === 'win32') installWindows()
  else { console.error(`  Unsupported platform: ${p}`); process.exit(1) }
}

export function uninstallService() {
  console.log('\n[Vault Admin] Removing background service...\n')
  const p = platform()
  if (p === 'linux') uninstallLinux()
  else if (p === 'darwin') uninstallMacos()
  else if (p === 'win32') uninstallWindows()
  else { console.error(`  Unsupported platform: ${p}`); process.exit(1) }
}

export function restartService() {
  console.log('\n[Vault Admin] Restarting background service...\n')
  const p = platform()

  if (p === 'linux') {
    if (!existsSync(SYSTEMD_FILE)) {
      console.error('  ✗ Service is not installed. Run: vault-admin --install-service')
      process.exit(1)
    }
    if (tryRun('systemctl --user restart vault-admin')) {
      console.log('  ✓ Service restarted')
      console.log(`  Open: http://localhost:${PORT}\n`)
    } else {
      console.error('  ✗ Restart failed — run manually: systemctl --user restart vault-admin')
      process.exit(1)
    }

  } else if (p === 'darwin') {
    if (!existsSync(PLIST_FILE)) {
      console.error('  ✗ Service is not installed. Run: vault-admin --install-service')
      process.exit(1)
    }
    tryRun(`launchctl unload "${PLIST_FILE}"`)
    if (tryRun(`launchctl load "${PLIST_FILE}"`)) {
      console.log('  ✓ Service restarted')
      console.log(`  Open: http://localhost:${PORT}\n`)
    } else {
      console.error(`  ✗ Restart failed — run manually: launchctl unload "${PLIST_FILE}" && launchctl load "${PLIST_FILE}"`)
      process.exit(1)
    }

  } else if (p === 'win32') {
    const taskExists = tryRun(
      'powershell -NoProfile -Command "Get-ScheduledTask -TaskName VaultAdmin -ErrorAction Stop | Out-Null"'
    )
    if (!taskExists) {
      console.error('  ✗ Service is not installed. Run: vault-admin --install-service')
      process.exit(1)
    }
    if (tryRun('powershell -NoProfile -ExecutionPolicy Bypass -Command "Stop-ScheduledTask -TaskName VaultAdmin -ErrorAction SilentlyContinue; Start-ScheduledTask -TaskName VaultAdmin"')) {
      console.log('  ✓ Service restarted')
      console.log(`  Open: http://localhost:${PORT}\n`)
    } else {
      console.error('  ✗ Restart failed — run manually: Stop-ScheduledTask -TaskName VaultAdmin; Start-ScheduledTask -TaskName VaultAdmin')
      process.exit(1)
    }

  } else {
    console.error(`  Unsupported platform: ${p}`)
    process.exit(1)
  }
}
