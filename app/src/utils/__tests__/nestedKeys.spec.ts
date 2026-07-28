import { describe, it, expect } from 'vitest'
import { setNestedValue, removeNestedKey, renameNestedKey, editTopLevelRow, findKeyPaths, getNestedValue, mergeSecretData } from '../nestedKeys'

describe('editTopLevelRow (SecretPanel.saveRow regression — reported bug)', () => {
  it('preserves a native nested sibling untouched when editing an unrelated plain row', () => {
    const before = {
      environment: 'dev',
      config: { database: { host: 'db.internal', port: 5432 } },
    }
    const after = editTopLevelRow(before, 'environment', 'environment', 'prod')

    expect(after.environment).toBe('prod')
    // The nested sibling must stay a native object, not get JSON.stringify'd.
    expect(typeof after.config).toBe('object')
    expect(after.config).toEqual(before.config)
    expect(after.config).not.toBe('[object Object]')
  })

  it('preserves a JSON-string-encoded sibling as a string, unchanged', () => {
    const before = {
      environment: 'dev',
      legacy: '{"a":"b"}',
    }
    const after = editTopLevelRow(before, 'environment', 'environment', 'prod')
    expect(after.legacy).toBe('{"a":"b"}')
  })

  it('renames the key while keeping its position and leaving other keys alone', () => {
    const before = { a: '1', b: '2', c: { x: 1 } }
    const after = editTopLevelRow(before, 'b', 'renamed', '2')
    expect(Object.keys(after)).toEqual(['a', 'renamed', 'c'])
    expect(after.c).toEqual({ x: 1 })
  })

  it('preserves number, boolean, null and array sibling values verbatim', () => {
    const before = { edited: 'x', n: 42, b: true, nul: null, arr: [1, 2, 3] }
    const after = editTopLevelRow(before, 'edited', 'edited', 'y')
    expect(after.n).toBe(42)
    expect(after.b).toBe(true)
    expect(after.nul).toBeNull()
    expect(after.arr).toEqual([1, 2, 3])
  })
})

describe('setNestedValue / removeNestedKey / renameNestedKey — encoding preservation', () => {
  it('adds a leaf 2 levels deep under a native object, preserving siblings', () => {
    const before = { application: { oauth: { clientId: 'abc', enabled: true } }, environment: 'dev' }
    const after = setNestedValue(before, ['application', 'oauth', 'clientSecret'], 'xyz')
    expect(after.application).toEqual({
      oauth: { clientId: 'abc', enabled: true, clientSecret: 'xyz' },
    })
    expect(typeof after.application).toBe('object')
    expect(after.environment).toBe('dev')
  })

  it('adds a leaf 5 levels deep under a native object', () => {
    const before = { a: { b: { c: { d: { e: 'old' } } } } }
    const after = setNestedValue(before, ['a', 'b', 'c', 'd', 'f'], 'new')
    expect(after.a).toEqual({ b: { c: { d: { e: 'old', f: 'new' } } } })
  })

  it('never mutates an unrelated top-level sibling (value, structure and type)', () => {
    const before = { target: { x: 1 }, sibling: { y: { z: [1, 2] } }, flat: 'v' }
    const after = setNestedValue(before, ['target', 'x'], '2')
    expect(after.sibling).toEqual(before.sibling)
    expect(after.sibling).toBe(before.sibling) // untouched sibling: same reference is fine, just not corrupted
    expect(after.flat).toBe('v')
  })

  it('a top-level key already stored as a JSON string keeps that encoding after a nested edit (representation-preserving policy)', () => {
    const before = { configuration: JSON.stringify({ database: { host: 'localhost' } }) }
    const after = setNestedValue(before, ['configuration', 'database', 'port'], '5432')
    expect(typeof after.configuration).toBe('string')
    expect(JSON.parse(after.configuration as string)).toEqual({ database: { host: 'localhost', port: '5432' } })
  })

  it('removes a nested leaf without touching siblings', () => {
    const before = { a: { keep: 1, drop: 2 }, b: 'unchanged' }
    const after = removeNestedKey(before, ['a', 'drop'])
    expect(after.a).toEqual({ keep: 1 })
    expect(after.b).toBe('unchanged')
  })

  it('removes a nested leaf under a JSON-string parent, keeping the string encoding', () => {
    const before = { a: JSON.stringify({ keep: 1, drop: 2 }) }
    const after = removeNestedKey(before, ['a', 'drop'])
    expect(typeof after.a).toBe('string')
    expect(JSON.parse(after.a as string)).toEqual({ keep: 1 })
  })

  it('renames a nested leaf without touching siblings', () => {
    const before = { a: { old: 1 }, b: 'unchanged' }
    const after = renameNestedKey(before, ['a', 'old'], 'renamed')
    expect(after.a).toEqual({ renamed: 1 })
    expect(after.b).toBe('unchanged')
  })
})

describe('findKeyPaths / getNestedValue — path-segment based (literal-dot-key regression)', () => {
  it('finds all matches for a leaf key, including duplicates at different locations', () => {
    const data = {
      frontend: { oauth: { enabled: false } },
      backend: { oauth: { enabled: true } },
    }
    const paths = findKeyPaths(data, 'enabled')
    expect(paths).toEqual([
      ['frontend', 'oauth', 'enabled'],
      ['backend', 'oauth', 'enabled'],
    ])
  })

  it('never re-splits a literal key name that contains a dot', () => {
    const data = { 'spring.datasource.url': 'jdbc:postgresql://localhost/db' }
    const paths = findKeyPaths(data, 'spring.datasource.url')
    // The whole literal key is one segment — not split into spring/datasource/url.
    expect(paths).toEqual([['spring.datasource.url']])
    expect(getNestedValue(data, paths[0])).toBe('jdbc:postgresql://localhost/db')
  })

  it('setNestedValue on a literal dotted key updates only that key, not a 3-level nested structure', () => {
    const before = {
      'spring.datasource.url': 'jdbc:postgresql://localhost/db',
      'spring.datasource.username': 'user',
    }
    const after = setNestedValue(before, ['spring.datasource.url'], 'jdbc:postgresql://new-host/db')
    expect(after).toEqual({
      'spring.datasource.url': 'jdbc:postgresql://new-host/db',
      'spring.datasource.username': 'user',
    })
    expect(after.spring).toBeUndefined()
  })
})

describe('mergeSecretData (CloneModal — encoding preservation on merge)', () => {
  it('merges natively when both target and source hold a native object for the key', () => {
    const target = { config: { a: 1, keep: true } }
    const source = { config: { a: 2 } }
    const after = mergeSecretData(target, source)
    expect(after.config).toEqual({ a: 2, keep: true })
    expect(typeof after.config).toBe('object')
  })

  it('adds a key entirely absent on the target as the source native structure', () => {
    const target = {}
    const source = { config: { a: 1 } }
    const after = mergeSecretData(target, source)
    expect(after.config).toEqual({ a: 1 })
  })

  it('parses, merges and re-serializes when target stores the key as a parsable JSON string', () => {
    const target = { config: JSON.stringify({ a: 1, keep: true }) }
    const source = { config: { a: 2 } }
    const after = mergeSecretData(target, source)
    expect(typeof after.config).toBe('string')
    expect(JSON.parse(after.config as string)).toEqual({ a: 2, keep: true })
  })

  it('replaces outright when target holds a non-parsable string for the key', () => {
    const target = { config: 'not-json-at-all' }
    const source = { config: { a: 1 } }
    const after = mergeSecretData(target, source)
    expect(after.config).toEqual({ a: 1 })
  })
})
