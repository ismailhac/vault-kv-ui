import { describe, it, expect } from 'vitest'
import { parseJsonSecretObject } from '../jsonSecret'

describe('parseJsonSecretObject (BulkEditModal / CreateSecretModal JSON mode — reported [object Object] bug)', () => {
  it('preserves a nested object value verbatim — never "[object Object]"', () => {
    const text = JSON.stringify({
      configuration: { database: { host: 'db.internal', port: 5432 } },
    })
    const parsed = parseJsonSecretObject(text)
    expect(parsed).not.toBeNull()
    expect(parsed!.configuration).toEqual({ database: { host: 'db.internal', port: 5432 } })
    expect(JSON.stringify(parsed!.configuration)).not.toContain('[object Object]')
  })

  it('preserves number, boolean and null types without stringifying', () => {
    const parsed = parseJsonSecretObject(JSON.stringify({ n: 42, b: true, nul: null, s: 'text' }))
    expect(parsed).toEqual({ n: 42, b: true, nul: null, s: 'text' })
  })

  it('preserves a string that looks like JSON as a string, not as a parsed object', () => {
    const parsed = parseJsonSecretObject(JSON.stringify({ legacy: '{"a":"b"}' }))
    expect(typeof parsed!.legacy).toBe('string')
    expect(parsed!.legacy).toBe('{"a":"b"}')
  })

  it('rejects invalid JSON', () => {
    expect(parseJsonSecretObject('{not json')).toBeNull()
  })

  it('rejects a top-level array', () => {
    expect(parseJsonSecretObject('[1,2,3]')).toBeNull()
  })

  it('rejects null', () => {
    expect(parseJsonSecretObject('null')).toBeNull()
  })
})
