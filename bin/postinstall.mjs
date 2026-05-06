#!/usr/bin/env node
// Welcome banner shown after: npm install -g vault-admin
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

try {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const { version } = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))

  const inner = 44 // inner width between the box borders
  const center = (str) => {
    const pad = Math.max(0, inner - str.length)
    const left = Math.floor(pad / 2)
    const right = pad - left
    return ' '.repeat(left) + str + ' '.repeat(right)
  }
  const ljust = (str) => str + ' '.repeat(Math.max(0, inner - str.length))

  console.log('')
  console.log('╔' + '═'.repeat(inner) + '╗')
  console.log('║' + center('vault-admin v' + version + ' installed') + '║')
  console.log('╠' + '═'.repeat(inner) + '╣')
  console.log('║' + ljust('  Run:   vault-admin') + '║')
  console.log('║' + ljust('  Docs:  github.com/ismailhac/vault-kv-ui') + '║')
  console.log('╚' + '═'.repeat(inner) + '╝')
  console.log('')
} catch (_) {
  // Silently ignore — banner is cosmetic, must not block install
}
