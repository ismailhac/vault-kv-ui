#!/usr/bin/env node
// Welcome banner shown after: npm install -g vault-admin
import { readFileSync, openSync, writeSync, closeSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

try {
  const __dirname = dirname(fileURLToPath(import.meta.url))
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

  // Write directly to the terminal device — bypasses npm's stdio piping
  try {
    const tty = openSync('/dev/tty', 'w')
    writeSync(tty, banner)
    closeSync(tty)
  } catch {
    process.stderr.write(banner)
  }
} catch (_) {
  // Silently ignore — banner is cosmetic, must not block install
}
