import type { MoneyEntry, RoomMember, Settlement } from '../db/types'

/** Normalize display name for alias matching: trim + case-insensitive. */
export function normalizeDisplayName(name: string | null | undefined): string {
  return (name || '').trim().toLowerCase()
}

export type IdentityContext = {
  members: RoomMember[]
  /** Optional money entries used to discover name↔id links from historical data. */
  entries?: MoneyEntry[]
}

/**
 * Build alias sets: ids that share the same normalized displayName are aliases.
 * Sources: room members + entry paidByName/participantNames.
 */
export function buildAliasSets(ctx: IdentityContext): Map<string, Set<string>> {
  /** normalizedName → set of ids */
  const byName = new Map<string, Set<string>>()

  function link(id: string | null | undefined, name: string | null | undefined) {
    if (!id) return
    const key = normalizeDisplayName(name)
    if (!key) {
      // Still register id alone under a unique key so lookup works
      const alone = byName.get(`__id:${id}`) || new Set<string>()
      alone.add(id)
      byName.set(`__id:${id}`, alone)
      return
    }
    const set = byName.get(key) || new Set<string>()
    set.add(id)
    byName.set(key, set)
  }

  for (const m of ctx.members) {
    if (m.deleted) continue
    link(m.id, m.displayName)
  }

  for (const e of ctx.entries || []) {
    if (e.deleted) continue
    if (e.paidById) link(e.paidById, e.paidByName)
    const ids = e.participantIds || []
    const names = e.participantNames || []
    for (let i = 0; i < ids.length; i++) {
      link(ids[i], names[i])
    }
    if (e.shares) {
      for (const id of Object.keys(e.shares)) {
        // Try to find a name from members or participant lists
        const m = ctx.members.find((x) => x.id === id)
        const idx = ids.indexOf(id)
        link(id, m?.displayName || (idx >= 0 ? names[idx] : undefined))
      }
    }
  }

  // Flatten: id → full alias set (union of all name-groups that contain this id)
  const idToAliases = new Map<string, Set<string>>()
  for (const set of byName.values()) {
    for (const id of set) {
      const existing = idToAliases.get(id) || new Set<string>()
      for (const other of set) existing.add(other)
      idToAliases.set(id, existing)
    }
  }
  // Every id aliases itself
  for (const m of ctx.members) {
    if (m.deleted) continue
    if (!idToAliases.has(m.id)) idToAliases.set(m.id, new Set([m.id]))
  }

  return idToAliases
}

export function aliasSetFor(
  id: string | null | undefined,
  aliasMap: Map<string, Set<string>>,
): Set<string> {
  if (!id) return new Set()
  return aliasMap.get(id) || new Set([id])
}

export function idsEquivalent(
  a: string | null | undefined,
  b: string | null | undefined,
  aliasMap: Map<string, Set<string>>,
): boolean {
  if (!a || !b) return false
  if (a === b) return true
  const setA = aliasMap.get(a)
  if (setA?.has(b)) return true
  const setB = aliasMap.get(b)
  return Boolean(setB?.has(a))
}

/**
 * Prefer auth/current id when present in the alias set; otherwise first sorted id.
 */
export function canonicalIdFor(
  id: string | null | undefined,
  preferredIds: string[],
  aliasMap: Map<string, Set<string>>,
): string | null {
  if (!id) return null
  const aliases = aliasMap.get(id) || new Set([id])
  for (const pref of preferredIds) {
    if (aliases.has(pref)) return pref
  }
  return [...aliases].sort()[0] || id
}

/** True if userId (or any alias) is among the given id list. */
export function idListIncludes(
  ids: string[] | null | undefined,
  userId: string,
  aliasMap: Map<string, Set<string>>,
): boolean {
  if (!ids?.length) return false
  const aliases = aliasSetFor(userId, aliasMap)
  return ids.some((id) => aliases.has(id))
}

/**
 * Look up share amount treating any alias of userId as the same person.
 * Sums values if multiple alias keys somehow appear (should be rare).
 */
export function shareAmountFromMap(
  shares: Record<string, number> | null | undefined,
  userId: string,
  aliasMap: Map<string, Set<string>>,
): number | undefined {
  if (!shares) return undefined
  const aliases = aliasSetFor(userId, aliasMap)
  let found = false
  let sum = 0
  for (const [k, v] of Object.entries(shares)) {
    if (aliases.has(k)) {
      found = true
      sum += Number(v) || 0
    }
  }
  return found ? Math.round(sum * 100) / 100 : undefined
}

/**
 * Resolve partner among active members (excluding me + my aliases).
 * - 0 others → null
 * - 1 other → that member
 * - multiple → prefer settings.partnerName match, else most frequent in money ids, else null (caller shows picker)
 */
export function resolvePartnerMember(
  members: RoomMember[],
  meId: string,
  opts: {
    partnerName?: string | null
    entries?: MoneyEntry[]
    settlements?: Settlement[]
    aliasMap?: Map<string, Set<string>>
    /** When user explicitly picked a partner id */
    preferredPartnerId?: string | null
  } = {},
): { partner: RoomMember | null; candidates: RoomMember[]; ambiguous: boolean } {
  const aliasMap = opts.aliasMap || buildAliasSets({ members, entries: opts.entries })
  const myAliases = aliasSetFor(meId, aliasMap)
  const others = members.filter((m) => !m.deleted && !myAliases.has(m.id))

  if (others.length === 0) {
    return { partner: null, candidates: [], ambiguous: false }
  }
  if (others.length === 1) {
    return { partner: others[0], candidates: others, ambiguous: false }
  }

  // Explicit picker preference
  if (opts.preferredPartnerId) {
    const picked = others.find((m) => m.id === opts.preferredPartnerId)
    if (picked) return { partner: picked, candidates: others, ambiguous: false }
  }

  // Match settings.partnerName
  const want = normalizeDisplayName(opts.partnerName)
  if (want) {
    const byName = others.filter((m) => normalizeDisplayName(m.displayName) === want)
    if (byName.length === 1) {
      return { partner: byName[0], candidates: others, ambiguous: false }
    }
  }

  // Most frequent in money paidById / participantIds / settlement from/to
  const scores = new Map<string, number>()
  for (const m of others) scores.set(m.id, 0)

  const bump = (id: string | null | undefined) => {
    if (!id || myAliases.has(id)) return
    // Score the candidate whose aliases include this id
    for (const m of others) {
      if (idsEquivalent(m.id, id, aliasMap)) {
        scores.set(m.id, (scores.get(m.id) || 0) + 1)
      }
    }
  }

  for (const e of opts.entries || []) {
    if (e.deleted) continue
    bump(e.paidById)
    for (const id of e.participantIds || []) bump(id)
  }
  for (const s of opts.settlements || []) {
    if (s.deleted) continue
    bump(s.fromUserId)
    bump(s.toUserId)
  }

  let best: RoomMember | null = null
  let bestScore = -1
  let tie = false
  for (const m of others) {
    const sc = scores.get(m.id) || 0
    if (sc > bestScore) {
      bestScore = sc
      best = m
      tie = false
    } else if (sc === bestScore) {
      tie = true
    }
  }

  if (best && bestScore > 0 && !tie) {
    return { partner: best, candidates: others, ambiguous: false }
  }

  // Ambiguous — do not silently pick
  return { partner: null, candidates: others, ambiguous: true }
}

/**
 * Duplicate displayName groups among active members (for Settings hint).
 */
export function duplicateDisplayNameGroups(members: RoomMember[]): string[] {
  const counts = new Map<string, { name: string; count: number }>()
  for (const m of members) {
    if (m.deleted) continue
    const key = normalizeDisplayName(m.displayName)
    if (!key) continue
    const cur = counts.get(key) || { name: m.displayName.trim(), count: 0 }
    cur.count += 1
    counts.set(key, cur)
  }
  return [...counts.values()].filter((x) => x.count > 1).map((x) => x.name)
}

/** Label for a member: name + optional email to distinguish duplicates. */
export function memberLabel(m: RoomMember, opts?: { showEmail?: boolean }): string {
  const name = m.displayName?.trim() || 'Traveler'
  if (opts?.showEmail !== false && m.email) {
    return `${name} (${m.email})`
  }
  return name
}
