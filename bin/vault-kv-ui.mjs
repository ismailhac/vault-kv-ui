#!/usr/bin/env node
import { createConnection } from 'net'
import { exec } from 'child_process'
import { platform } from 'os'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join } from 'path'
import { existsSync, readFileSync } from 'fs'

// Version check — must use only basic syntax so it runs on any Node version
const nodeMajor = parseInt(process.versions.node.split('.')[0], 10)
if (nodeMajor < 18) {
  console.error('[Vault Admin] ERROR: Node.js ' + process.versions.node + ' is not supported.')
  console.error('  Vault Admin requires Node.js 18 or later.')
  console.error('  Download the latest LTS version at: https://nodejs.org')
  process.exit(1)
}

const __dirname = dirname(fileURLToPath(import.meta.url))

// Version flag — must check before any server startup
if (process.argv.includes('--version') || process.argv.includes('-v')) {
  const { version } = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))
  console.log(version)
  process.exit(0)
}

// Help flag
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log([
    '',
    'Usage: vault-admin [options]',
    '',
    'Options:',
    '  --install-service    Install as a background service (auto-starts at login)',
    '  --uninstall-service  Remove the background service',
    '  --version, -v        Print version and exit',
    '  --help, -h           Show this help',
    '',
    'Environment:',
    '  BFF_PORT             Port to listen on (default: 3001)',
    '  VAULT_ADDR           Vault server URL',
    '  VAULT_TOKEN          Default Vault token',
    '',
  ].join('\n'))
  process.exit(0)
}

// Service management flags
if (process.argv.includes('--install-service')) {
  const { installService } = await import(pathToFileURL(join(__dirname, 'service.mjs')).href)
  installService()
  process.exit(0)
}

if (process.argv.includes('--uninstall-service')) {
  const { uninstallService } = await import(pathToFileURL(join(__dirname, 'service.mjs')).href)
  uninstallService()
  process.exit(0)
}

const PORT = parseInt(process.env.BFF_PORT || '3001')
const url = `http://localhost:${PORT}`
const distPath = join(__dirname, '..', 'app', 'dist', 'index.html')

if (!existsSync(distPath)) {
  console.error('[Vault Admin] ERROR: app/dist/ not found.')
  console.error('  This usually means the package was published without building the frontend.')
  console.error('  If you are developing locally, run: npm run build --prefix app')
  process.exit(1)
}

// Start the BFF then wait for it to accept connections
import(pathToFileURL(join(__dirname, '..', 'server', 'index.mjs')).href)
  .then(() => waitAndOpen(15))
  .catch(err => {
    console.error('[Vault Admin] Failed to start server:', err.message)
    process.exit(1)
  })

function waitAndOpen(attemptsLeft) {
  const sock = createConnection({ port: PORT, host: '127.0.0.1' })
  sock.once('connect', () => {
    sock.destroy()
    console.log(`\n  🔓 Vault Admin → ${url}\n`)
    setTimeout(() => {
      if (!process.env.SSH_CLIENT && !process.env.SSH_TTY && !process.env.VAULT_ADMIN_SERVICE) {
        const cmd =
          platform() === 'darwin' ? `open "${url}"` :
          platform() === 'win32' ? `start "" "${url}"` :
          `xdg-open "${url}"`
        exec(cmd, err => {
          if (err) console.warn('[Vault Admin] Could not open browser automatically:', err.message)
        })
      }
    }, 500)
  })
  sock.once('error', () => {
    sock.destroy()
    if (attemptsLeft <= 0) {
      console.warn('[Vault Admin] Server did not start in time — open manually:', url)
      return
    }
    setTimeout(() => waitAndOpen(attemptsLeft - 1), 200)
  })
}
