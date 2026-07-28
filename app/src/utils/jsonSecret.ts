/**
 * Parse user-typed JSON for a single secret's data. Returns the parsed object
 * verbatim — every value keeps the exact type the user typed (object stays
 * object, number stays number, a string stays a string) since a stray
 * `String(v)` on an object silently produces `"[object Object]"`.
 */
export function parseJsonSecretObject(text: string): Record<string, unknown> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  return parsed as Record<string, unknown>
}
