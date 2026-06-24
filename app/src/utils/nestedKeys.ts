/**
 * Find all dot-paths within secret data where the given leaf key name exists.
 * Navigates through both native objects and JSON-string-encoded values.
 */
export function findKeyPaths(data: Record<string, unknown>, leafKey: string): string[] {
  const results: string[] = []

  function walk(obj: unknown, prefix: string): void {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key
      if (key === leafKey) results.push(path)
      let child: unknown = val
      if (typeof val === 'string') { try { child = JSON.parse(val) } catch { /* not JSON */ } }
      if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
        walk(child, path)
      }
    }
  }

  walk(data, '')
  return results
}

/**
 * Get the leaf value at a dot-path, navigating through native objects and JSON-string-encoded values.
 */
export function getNestedValue(data: Record<string, unknown>, dotPath: string): unknown {
  const parts = dotPath.split('.')
  let current: unknown = data
  for (const part of parts) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined
    const obj = current as Record<string, unknown>
    if (!(part in obj)) return undefined
    let val = obj[part]
    if (typeof val === 'string') { try { val = JSON.parse(val) } catch { /* not JSON */ } }
    current = val
  }
  return current
}

/**
 * Set a value at a dot-path.
 * Returns Record<string,unknown> preserving the original encoding of every key:
 * a top-level key that was a native object stays a native object;
 * one that was a JSON-string stays a JSON-string.
 */
export function setNestedValue(
  data: Record<string, unknown>,
  dotPath: string,
  newValue: string,
): Record<string, unknown> {
  const result = { ...data }
  const parts = dotPath.split('.')
  const topKey = parts[0]
  if (parts.length === 1) {
    result[topKey] = newValue
    return result
  }
  let obj: unknown = data[topKey]
  if (typeof obj === 'string') { try { obj = JSON.parse(obj) } catch { obj = {} } }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) obj = {}
  const cloned = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>
  setDeep(cloned, parts.slice(1), newValue)
  result[topKey] = cloned
  return result
}

/**
 * Remove a key at a dot-path.
 * Preserves the original encoding of the modified top-level key.
 */
export function removeNestedKey(
  data: Record<string, unknown>,
  dotPath: string,
): Record<string, unknown> {
  const result = { ...data }
  const parts = dotPath.split('.')
  const topKey = parts[0]
  if (parts.length === 1) {
    delete result[topKey]
    return result
  }
  let obj: unknown = data[topKey]
  if (typeof obj === 'string') { try { obj = JSON.parse(obj) } catch { return result } }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return result
  const cloned = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>
  removeDeep(cloned, parts.slice(1))
  result[topKey] = cloned
  return result
}

/**
 * Rename a leaf key at a dot-path.
 * Preserves the original encoding of the modified top-level key.
 */
export function renameNestedKey(
  data: Record<string, unknown>,
  dotPath: string,
  newLeafName: string,
): Record<string, unknown> {
  const result = { ...data }
  const parts = dotPath.split('.')
  const topKey = parts[0]
  if (parts.length === 1) {
    const value = data[topKey]
    delete result[topKey]
    result[newLeafName] = value
    return result
  }
  let obj: unknown = data[topKey]
  if (typeof obj === 'string') { try { obj = JSON.parse(obj) } catch { return result } }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return result
  const cloned = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>
  renameDeep(cloned, parts.slice(1), newLeafName)
  result[topKey] = cloned
  return result
}

/** Normalize any secret data to flat Record<string,string>. */
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
