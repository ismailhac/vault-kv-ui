export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type SecretData = Record<string, JsonValue>

/**
 * A path to a nested key, as an ordered list of key segments — never a dotted
 * string. A literal key name that itself contains a dot (e.g. "spring.datasource.url")
 * must never be re-split, which is why paths are carried as arrays end-to-end and
 * only joined with '.' for display.
 */
export type SecretPath = readonly (string | number)[]

export function pathToDisplay(path: SecretPath): string {
  return path.join('.')
}
