#!/usr/bin/env node
import { createConnection } from 'node:net'
import { exec } from 'node:child_process'
import { platform } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'

const PORT = parseInt(process.env.BFF_PORT || '3001')
const url = `http://localhost:${PORT}`
const __dirname = dirname(fileURLToPath(import.meta.url))
const distPath = join(__dirname, '..', 'app', 'dist', 'index.html')

// Guard: dist must exist
if (!existsSync(distPath)) {
  console.error('[vault-kv-ui] ERROR: app/dist/ not found.')
  console.error('  This usually means the package was published without building the frontend.')
  console.error('  If you are developing locally, run: npm run build --prefix app')
  process.exit(1)
}

// Start the BFF (import as side-effect — server/index.mjs calls app.listen() at module level)
await import(join(__dirname, '..', 'server', 'index.mjs'))

// Wait for the server to accept connections, then open browser
function waitAndOpen(attemptsLeft) {
  const sock = createConnection({ port: PORT, host: '127.0.0.1' })
  sock.once('connect', () => {
    sock.destroy()
    console.log(`\n  🔓 Vault KV UI → ${url}\n`)
    // Give the server a moment to fully initialize before opening browser
    setTimeout(() => {
      if (!process.env.SSH_CLIENT && !process.env.SSH_TTY) {
        const cmd =
          platform() === 'darwin' ? `open "${url}"` :
          platform() === 'win32' ? `start "" "${url}"` :
          `xdg-open "${url}"`
        exec(cmd, err => {
          if (err) console.warn('[vault-kv-ui] Could not open browser automatically:', err.message)
        })
      }
    }, 500)
  })
  sock.once('error', () => {
    sock.destroy()
    if (attemptsLeft <= 0) {
      console.warn('[vault-kv-ui] Server did not start in time — open manually:', url)
      return
    }
    setTimeout(() => waitAndOpen(attemptsLeft - 1), 200)
  })
}

waitAndOpen(15)  // 15 × 200ms = 3s max wait
