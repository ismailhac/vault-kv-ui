#!/usr/bin/env node
// Runs after: npm install -g vault-admin
// 1. Shows a welcome/update banner
// 2. If the service is already installed, restarts it so BFF code changes take effect
import { readFileSync, existsSync, openSync, writeSync, closeSync } from 'fs'
import { execSync } from 'child_process'
import { platform, homedir } from 'os'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const HOME = homedir()

function tryRun(cmd) {
  try { execSync(cmd, { stdio: 'pipe' }); return true } catch { return false }
}

function writeTty(msg) {
  try {
    const tty = openSync('/dev/tty', 'w')
    writeSync(tty, msg)
    closeSync(tty)
  } catch {
    process.stderr.write(msg)
  }
}

// ── Banner ────────────────────────────────────────────────────────────────────

try {
  const { version } = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))

  const inner = 44
  const center = (str) => {
    const pad = Math.max(0, inner - str.length)
    const left = Math.floor(pad / 2)
    return ' '.repeat(left) + str + ' '.repeat(pad - left)
  }
  const ljust = (str) => str + ' '.repeat(Math.max(0, inner - str.length))

  const banner =
    '\n' +
    '╔' + '═'.repeat(inner) + '╗\n' +
    '║' + center('vault-admin v' + version + ' installed') + '║\n' +
    '╠' + '═'.repeat(inner) + '╣\n' +
    '║' + ljust('  Run:      vault-admin') + '║\n' +
    '║' + ljust('  Service:  vault-admin --install-service') + '║\n' +
    '║' + ljust('  Docs:     github.com/ismailhac/vault-kv-ui') + '║\n' +
    '╚' + '═'.repeat(inner) + '╝\n'

  writeTty(banner)
} catch (_) {
  // Banner is cosmetic — must not block install
}

// ── Auto-restart service if already installed ─────────────────────────────────
// The frontend files (app/dist/) are served fresh on every request and need no
// restart. The BFF (server/index.mjs) is loaded once and cached — a restart is
// required for server-side changes to take effect.

try {
  const p = platform()

  if (p === 'linux') {
    const serviceFile = join(HOME, '.config', 'systemd', 'user', 'vault-admin.service')
    if (existsSync(serviceFile)) {
      // try-restart only acts if the unit is currently active — safe to call always
      const ok = tryRun('systemctl --user try-restart vault-admin')
      writeTty(ok
        ? '  ↺ Service restarted — BFF updated\n\n'
        : '  ⚠ Service found but could not restart — run: systemctl --user restart vault-admin\n\n'
      )
    }

  } else if (p === 'darwin') {
    const plistFile = join(HOME, 'Library', 'LaunchAgents', 'com.vault-admin.plist')
    if (existsSync(plistFile)) {
      tryRun(`launchctl unload "${plistFile}"`)
      const ok = tryRun(`launchctl load "${plistFile}"`)
      writeTty(ok
        ? '  ↺ Service restarted — BFF updated\n\n'
        : `  ⚠ Service found but could not restart — run: launchctl unload "${plistFile}" && launchctl load "${plistFile}"\n\n`
      )
    }

  } else if (p === 'win32') {
    const taskExists = tryRun(
      'powershell -NoProfile -Command "Get-ScheduledTask -TaskName VaultAdmin -ErrorAction Stop | Out-Null"'
    )
    if (taskExists) {
      const ok = tryRun(
        'powershell -NoProfile -ExecutionPolicy Bypass -Command "Stop-ScheduledTask -TaskName VaultAdmin -ErrorAction SilentlyContinue; Start-ScheduledTask -TaskName VaultAdmin"'
      )
      writeTty(ok
        ? '  ↺ Service restarted — BFF updated\n\n'
        : '  ⚠ Service found but could not restart — run: Stop-ScheduledTask -TaskName VaultAdmin; Start-ScheduledTask -TaskName VaultAdmin\n\n'
      )
    }
  }
} catch (_) {
  // Auto-restart is best-effort — must not block install
}
