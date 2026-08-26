const AVATAR_PALETTE = ['#2a7fb0', '#7c6fb0', '#b08a4c', '#4c9a6e', '#b05c5c', '#5c8fb0']

/** Presentation-only initials derived from a canonical name. */
export function deriveInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  const initials = parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
  return initials === '' ? '?' : initials
}

/** Deterministic avatar color for an identifier. */
export function deriveAvatarColor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length]
}
