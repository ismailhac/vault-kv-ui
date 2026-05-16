const ENV_SEGMENTS = ['dev', 'uat', 'staging', 'prod', 'production', 'preprod', 'qa', 'test', 'sandbox']

export function detectEnvSegment(path: string): { segment: string; index: number } | null {
  const parts = path.split('/').filter(Boolean)
  for (let i = 0; i < parts.length; i++) {
    if (ENV_SEGMENTS.includes(parts[i].toLowerCase())) {
      return { segment: parts[i], index: i }
    }
  }
  return null
}

export function siblingEnvPaths(path: string): string[] {
  const detected = detectEnvSegment(path)
  if (!detected) return []
  const parts = path.split('/').filter(Boolean)
  const suggestions: string[] = []
  for (const env of ENV_SEGMENTS) {
    if (env === detected.segment.toLowerCase()) continue
    const sibling = [...parts]
    sibling[detected.index] = env
    const siblingPath = sibling.join('/')
    if (siblingPath !== path) suggestions.push(siblingPath)
  }
  return suggestions.slice(0, 5)
}
