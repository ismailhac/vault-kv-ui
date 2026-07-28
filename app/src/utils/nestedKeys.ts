import type { SecretPath } from '../types/secret'

/**
 * Find all paths within secret data where the given leaf key name exists.
 * Navigates through both native objects and JSON-string-encoded values.
 * Returns segment arrays, not dotted strings — a literal key containing a dot
 * must never be re-split against the data.
 */
export function findKeyPaths(data: Record<string, unknown>, leafKey: string): SecretPath[] {
  const results: SecretPath[] = []

  function walk(obj: unknown, prefix: readonly string[]): void {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      const path = [...prefix, key]
      if (key === leafKey) results.push(path)
      let child: unknown = val
      if (typeof val === 'string') { try { child = JSON.parse(val) } catch { /* not JSON */ } }
      if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
        walk(child, path)
      }
    }
  }

  walk(data, [])
  return results
}

/**
 * Get the leaf value at a path, navigating through native objects and JSON-string-encoded values.
 */
export function getNestedValue(data: Record<string, unknown>, path: SecretPath): unknown {
  let current: unknown = data
  for (const part of path) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined
    const obj = current as Record<string, unknown>
    if (!(String(part) in obj)) return undefined
    let val = obj[String(part)]
    if (typeof val === 'string') { try { val = JSON.parse(val) } catch { /* not JSON */ } }
    current = val
  }
  return current
}

/**
 * Set a value at a path. Representation-preserving: a top-level key that was a
 * native object stays a native object after the edit; one that was a JSON-string
 * stays a JSON-string. No implicit normalization in either direction.
 */
export function setNestedValue(
  data: Record<string, unknown>,
  path: SecretPath,
  newValue: string,
): Record<string, unknown> {
  const result = { ...data }
  const topKey = String(path[0])
  if (path.length === 1) {
    result[topKey] = newValue
    return result
  }
  const raw = data[topKey]
  const wasString = typeof raw === 'string'
  let obj: unknown = wasString ? (() => { try { return JSON.parse(raw as string) } catch { return {} } })() : raw
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) obj = {}
  const cloned = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>
  setDeep(cloned, path.slice(1).map(String), newValue)
  result[topKey] = wasString ? JSON.stringify(cloned) : cloned
  return result
}

/**
 * Remove a key at a path. Preserves the original encoding of the modified top-level key.
 */
export function removeNestedKey(
  data: Record<string, unknown>,
  path: SecretPath,
): Record<string, unknown> {
  const result = { ...data }
  const topKey = String(path[0])
  if (path.length === 1) {
    delete result[topKey]
    return result
  }
  const raw = data[topKey]
  const wasString = typeof raw === 'string'
  let obj: unknown = wasString ? (() => { try { return JSON.parse(raw as string) } catch { return undefined } })() : raw
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return result
  const cloned = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>
  removeDeep(cloned, path.slice(1).map(String))
  result[topKey] = wasString ? JSON.stringify(cloned) : cloned
  return result
}

/**
 * Rename a leaf key at a path. Preserves the original encoding of the modified top-level key.
 */
export function renameNestedKey(
  data: Record<string, unknown>,
  path: SecretPath,
  newLeafName: string,
): Record<string, unknown> {
  const result = { ...data }
  const topKey = String(path[0])
  if (path.length === 1) {
    const value = data[topKey]
    delete result[topKey]
    result[newLeafName] = value
    return result
  }
  const raw = data[topKey]
  const wasString = typeof raw === 'string'
  let obj: unknown = wasString ? (() => { try { return JSON.parse(raw as string) } catch { return undefined } })() : raw
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return result
  const cloned = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>
  renameDeep(cloned, path.slice(1).map(String), newLeafName)
  result[topKey] = wasString ? JSON.stringify(cloned) : cloned
  return result
}

/**
 * Deep-merge `source` into `target`, representation-preserving: if a key is a
 * native object on both sides, merge natively; if `target`'s existing value is a
 * parsable JSON string, parse-merge-reserialize so it stays a string; if it's a
 * non-parsable string or any other type, `source` wins outright (no merge to fall back to).
 * Used by CloneModal to propagate values into a sibling secret without changing
 * that secret's pre-existing encoding.
 */
export function mergeSecretData(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target }
  for (const [key, srcVal] of Object.entries(source)) {
    const tgtVal = result[key]
    const srcIsObject = srcVal !== null && typeof srcVal === 'object' && !Array.isArray(srcVal)
    if (srcIsObject && tgtVal !== null && typeof tgtVal === 'object' && !Array.isArray(tgtVal)) {
      result[key] = mergeSecretData(tgtVal as Record<string, unknown>, srcVal as Record<string, unknown>)
    } else if (srcIsObject && typeof tgtVal === 'string') {
      try {
        const parsed = JSON.parse(tgtVal)
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          result[key] = JSON.stringify(mergeSecretData(parsed as Record<string, unknown>, srcVal as Record<string, unknown>))
        } else {
          result[key] = srcVal
        }
      } catch {
        result[key] = srcVal
      }
    } else {
      result[key] = srcVal
    }
  }
  return result
}

/**
 * Build the write payload for editing a single top-level plain row (key rename
 * and/or value change). Every other top-level key is copied through verbatim —
 * its encoding (native object, JSON string, number, boolean, ...) is never touched.
 */
export function editTopLevelRow(
  data: Record<string, unknown>,
  originalKey: string,
  newKey: string,
  newValue: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    result[k === originalKey ? newKey : k] = k === originalKey ? newValue : v
  }
  return result
}

/** Normalize any secret data to flat Record<string,string> for display purposes only. */
export function toStringRecord(data: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(data).map(([k, v]) => [
      k,
      typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? ''),
    ])
  )
}

function setDeep(obj: Record<string, unknown>, parts: string[], value: unknown): void {
  const [head, ...rest] = parts
  if (!rest.length) { obj[head] = value; return }
  if (typeof obj[head] !== 'object' || obj[head] === null) obj[head] = {}
  setDeep(obj[head] as Record<string, unknown>, rest, value)
}

function removeDeep(obj: Record<string, unknown>, parts: string[]): void {
  const [head, ...rest] = parts
  if (!rest.length) { delete obj[head]; return }
  if (typeof obj[head] === 'object' && obj[head] !== null) {
    removeDeep(obj[head] as Record<string, unknown>, rest)
  }
}

function renameDeep(obj: Record<string, unknown>, parts: string[], newName: string): void {
  const [head, ...rest] = parts
  if (!rest.length) {
    if (head in obj) { obj[newName] = obj[head]; delete obj[head] }
    return
  }
  if (typeof obj[head] === 'object' && obj[head] !== null) {
    renameDeep(obj[head] as Record<string, unknown>, rest, newName)
  }
}
