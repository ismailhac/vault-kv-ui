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
 * Set a value at a dot-path, returning a normalized Record<string,string>.
 * Nested parent objects are re-serialized as JSON strings.
 */
export function setNestedValue(
  data: Record<string, unknown>,
  dotPath: string,
  newValue: string,
): Record<string, string> {
  const normalized = toStringRecord(data)
  const parts = dotPath.split('.')
  if (parts.length === 1) {
    normalized[parts[0]] = newValue
    return normalized
  }
  const topKey = parts[0]
  let raw: unknown = data[topKey]
  if (typeof raw === 'string') { try { raw = JSON.parse(raw) } catch { raw = {} } }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) raw = {}
  const cloned = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>
  setDeep(cloned, parts.slice(1), newValue)
  normalized[topKey] = JSON.stringify(cloned)
  return normalized
}

/**
 * Remove a key at a dot-path, returning a normalized Record<string,string>.
 */
export function removeNestedKey(
  data: Record<string, unknown>,
  dotPath: string,
): Record<string, string> {
  const normalized = toStringRecord(data)
  const parts = dotPath.split('.')
  if (parts.length === 1) {
    delete normalized[parts[0]]
    return normalized
  }
  const topKey = parts[0]
  let raw: unknown = data[topKey]
  if (typeof raw === 'string') { try { raw = JSON.parse(raw) } catch { return normalized } }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return normalized
  const cloned = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>
  removeDeep(cloned, parts.slice(1))
  normalized[topKey] = JSON.stringify(cloned)
  return normalized
}

/**
 * Rename a leaf key at a dot-path, returning a normalized Record<string,string>.
 */
export function renameNestedKey(
  data: Record<string, unknown>,
  dotPath: string,
  newLeafName: string,
): Record<string, string> {
  const normalized = toStringRecord(data)
  const parts = dotPath.split('.')
  if (parts.length === 1) {
    const value = normalized[parts[0]] ?? ''
    delete normalized[parts[0]]
    normalized[newLeafName] = value
    return normalized
  }
  const topKey = parts[0]
  let raw: unknown = data[topKey]
  if (typeof raw === 'string') { try { raw = JSON.parse(raw) } catch { return normalized } }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return normalized
  const cloned = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>
  renameDeep(cloned, parts.slice(1), newLeafName)
  normalized[topKey] = JSON.stringify(cloned)
  return normalized
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
