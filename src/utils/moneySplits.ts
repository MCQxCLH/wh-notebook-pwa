import type { EntryCurrency, MoneyEntry, Settlement } from '../db/types'
import {
  aliasSetFor,
  idListIncludes,
  idsEquivalent,
  shareAmountFromMap,
  type IdentityContext,
  buildAliasSets,
} from './identity'

export type EffectiveSplit = 'personal' | 'equal' | 'custom'

export type SplitIdentityOpts = {
  treatMissingPaidByAsUser?: boolean
  partnerId?: string | null
  /** Pre-built alias map; if omitted and members provided, built from members+entries. */
  aliasMap?: Map<string, Set<string>>
  members?: IdentityContext['members']
  entries?: MoneyEntry[]
}

function resolveAliasMap(opts?: SplitIdentityOpts): Map<string, Set<string>> {
  if (opts?.aliasMap) return opts.aliasMap
  if (opts?.members) {
    return buildAliasSets({ members: opts.members, entries: opts.entries })
  }
  return new Map()
}

/** Resolve entry currency; legacy missing → fallback (settings default or HKD). */
export function entryCurrency(
  entry: MoneyEntry | Settlement,
  fallback: string = 'HKD',
): EntryCurrency {
  const c = (entry.currency || fallback || 'HKD').toUpperCase()
  return c === 'AUD' ? 'AUD' : 'HKD'
}

export function filterByCurrency(
  entries: MoneyEntry[],
  currency: EntryCurrency,
  fallback: string = 'HKD',
): MoneyEntry[] {
  return entries.filter((e) => entryCurrency(e, fallback) === currency)
}

export function filterSettlementsByCurrency(
  settlements: Settlement[],
  currency: EntryCurrency,
  fallback: string = 'HKD',
): Settlement[] {
  return settlements.filter((s) => entryCurrency(s, fallback) === currency)
}

/**
 * Treat missing as personal; legacy `shared` → equal.
 */
export function effectiveSplitMode(entry: MoneyEntry): EffectiveSplit {
  const m = entry.splitMode
  if (m === 'equal' || m === 'shared') return 'equal'
  if (m === 'custom') return 'custom'
  return 'personal'
}

/** True if expense is shared (equal or custom). */
export function isSharedExpense(entry: MoneyEntry): boolean {
  if (entry.type !== 'expense') return false
  const m = effectiveSplitMode(entry)
  return m === 'equal' || m === 'custom'
}

function participantIdsFor(
  entry: MoneyEntry,
  meId: string,
  partnerId: string | null | undefined,
): string[] {
  if (entry.participantIds && entry.participantIds.length >= 2) {
    return entry.participantIds.filter(Boolean)
  }
  if (partnerId) return [meId, partnerId]
  return [meId]
}

/**
 * Absolute share amount a user owes toward an expense (or receives for income).
 * Treats alias ids (same displayName) as the same person when aliasMap/members given.
 */
export function shareForUser(
  entry: MoneyEntry,
  userId: string,
  opts?: SplitIdentityOpts,
): number {
  const treatMissing = opts?.treatMissingPaidByAsUser !== false
  const aliasMap = resolveAliasMap(opts)
  const myAliases = aliasSetFor(userId, aliasMap)
  const paidBy = entry.paidById
  const isMine =
    (paidBy != null && (paidBy === userId || myAliases.has(paidBy))) ||
    (paidBy == null && treatMissing)

  if (entry.type === 'income') {
    return isMine ? entry.amount : 0
  }

  const mode = effectiveSplitMode(entry)
  if (mode === 'personal') {
    return isMine ? entry.amount : 0
  }

  if (mode === 'custom') {
    const fromMap = shareAmountFromMap(entry.shares, userId, aliasMap)
    if (fromMap != null) return fromMap
    return 0
  }

  // equal
  const ids = entry.participantIds?.filter(Boolean) ?? []
  const n = ids.length >= 2 ? ids.length : 2
  if (ids.length > 0 && !idListIncludes(ids, userId, aliasMap)) {
    if (!(paidBy == null && treatMissing)) return 0
  }
  return Math.round((entry.amount / n) * 100) / 100
}

/**
 * Resolved share for display — prefers looking up via aliases so historical
 * docs keyed by old uids still attribute to the current user.
 */
export function shareForUserResolved(
  entry: MoneyEntry,
  meId: string,
  members: IdentityContext['members'],
  entries?: MoneyEntry[],
): number {
  const aliasMap = buildAliasSets({ members, entries })
  return shareForUser(entry, meId, { aliasMap, members, entries })
}

/** Share map for display / settlement. Keys stay as stored; lookup uses aliases. */
export function sharesForEntry(
  entry: MoneyEntry,
  meId: string,
  partnerId: string | null | undefined,
  _opts?: SplitIdentityOpts,
): Record<string, number> {
  const mode = effectiveSplitMode(entry)
  if (mode === 'custom' && entry.shares) {
    return { ...entry.shares }
  }
  if (mode === 'equal' || mode === 'custom') {
    const ids = participantIdsFor(entry, meId, partnerId)
    const n = Math.max(ids.length, 2)
    const each = Math.round((entry.amount / n) * 100) / 100
    const out: Record<string, number> = {}
    for (const id of ids) out[id] = each
    // Fix rounding drift on last participant
    if (ids.length >= 2) {
      const sumOthers = ids.slice(0, -1).reduce((s, id) => s + out[id], 0)
      out[ids[ids.length - 1]] = Math.round((entry.amount - sumOthers) * 100) / 100
    }
    return out
  }
  // personal — only payer
  const payer = entry.paidById || meId
  return { [payer]: entry.amount }
}

/** Full amount for group totals. */
export function groupAmount(entry: MoneyEntry): number {
  return entry.amount
}

/**
 * Net from shared expenses only (before settlements).
 * Positive ⇒ partner owes me; negative ⇒ I owe partner.
 * Uses alias equivalence so same-name / remapped uids still settle correctly.
 */
export function netFromSharedExpenses(
  entries: MoneyEntry[],
  meId: string,
  partnerId: string | null | undefined,
  opts?: SplitIdentityOpts,
): number {
  const aliasMap = resolveAliasMap(opts)
  const idOpts: SplitIdentityOpts = { ...opts, aliasMap }
  let net = 0
  for (const e of entries) {
    if (e.deleted) continue
    if (e.type !== 'expense') continue
    if (!isSharedExpense(e)) continue

    const ids = participantIdsFor(e, meId, partnerId)
    const shareMap = sharesForEntry(e, meId, partnerId, idOpts)
    const payer = e.paidById

    if (!payer) continue

    const payerIsMe = idsEquivalent(payer, meId, aliasMap)
    const payerIsPartner =
      Boolean(partnerId) && idsEquivalent(payer, partnerId!, aliasMap)

    if (payerIsMe) {
      for (const id of ids) {
        if (!idsEquivalent(id, meId, aliasMap)) {
          const amt = shareAmountFromMap(shareMap, id, aliasMap) ?? shareMap[id] ?? 0
          net += amt
        }
      }
      // Implied partner when only me listed
      if (ids.length === 1 && partnerId) {
        net +=
          shareAmountFromMap(shareMap, partnerId, aliasMap) ??
          shareMap[partnerId] ??
          e.amount / 2
      }
    } else if (payerIsPartner) {
      const myShare =
        shareAmountFromMap(shareMap, meId, aliasMap) ?? shareMap[meId]
      if (myShare != null) net -= myShare
      else if (idListIncludes(ids, meId, aliasMap) || ids.length < 2) {
        net -= e.amount / Math.max(ids.length, 2)
      }
    } else {
      // Third-party payer
      if (idListIncludes(ids, meId, aliasMap)) {
        net -= shareAmountFromMap(shareMap, meId, aliasMap) ?? shareMap[meId] ?? 0
      }
    }
  }
  return Math.round(net * 100) / 100
}

/**
 * Apply settlement payments to a net balance.
 * I paid them → net += amount (my debt shrinks).
 * They paid me → net -= amount (their debt shrinks).
 */
export function applySettlementsToNet(
  net: number,
  settlements: Settlement[],
  meId: string,
  opts?: SplitIdentityOpts,
): number {
  const aliasMap = resolveAliasMap(opts)
  let result = net
  for (const s of settlements) {
    if (s.deleted) continue
    if (idsEquivalent(s.fromUserId, meId, aliasMap)) result += s.amount
    else if (idsEquivalent(s.toUserId, meId, aliasMap)) result -= s.amount
  }
  return Math.round(result * 100) / 100
}

/**
 * Net balance from shared expenses minus settlement payments, for one currency slice.
 * Positive ⇒ partner owes me; negative ⇒ I owe partner.
 */
export function netBalance(
  entries: MoneyEntry[],
  meId: string,
  partnerId: string | null | undefined,
  settlements: Settlement[] = [],
  opts?: SplitIdentityOpts,
): number {
  const aliasMap = resolveAliasMap({ ...opts, entries })
  const idOpts = { ...opts, aliasMap, entries }
  const fromExpenses = netFromSharedExpenses(entries, meId, partnerId, idOpts)
  return applySettlementsToNet(fromExpenses, settlements, meId, idOpts)
}

export function personalIncome(
  entries: MoneyEntry[],
  userId: string,
  opts?: SplitIdentityOpts,
): number {
  const aliasMap = resolveAliasMap({ ...opts, entries })
  const idOpts = { ...opts, aliasMap, entries }
  let s = 0
  for (const e of entries) {
    if (e.deleted || e.type !== 'income') continue
    s += shareForUser(e, userId, idOpts)
  }
  return Math.round(s * 100) / 100
}

export function personalExpense(
  entries: MoneyEntry[],
  userId: string,
  opts?: SplitIdentityOpts,
): number {
  const aliasMap = resolveAliasMap({ ...opts, entries })
  const idOpts = { ...opts, aliasMap, entries }
  let s = 0
  for (const e of entries) {
    if (e.deleted || e.type !== 'expense') continue
    s += shareForUser(e, userId, idOpts)
  }
  return Math.round(s * 100) / 100
}

export function groupIncome(entries: MoneyEntry[]): number {
  let s = 0
  for (const e of entries) {
    if (e.deleted || e.type !== 'income') continue
    s += groupAmount(e)
  }
  return Math.round(s * 100) / 100
}

export function groupExpense(entries: MoneyEntry[]): number {
  let s = 0
  for (const e of entries) {
    if (e.deleted || e.type !== 'expense') continue
    s += groupAmount(e)
  }
  return Math.round(s * 100) / 100
}

export function scopeTotals(
  entries: MoneyEntry[],
  meId: string,
  opts?: SplitIdentityOpts,
): { income: number; expense: number; balance: number } {
  const income = meId ? personalIncome(entries, meId, opts) : groupIncome(entries)
  const expense = meId ? personalExpense(entries, meId, opts) : groupExpense(entries)
  return { income, expense, balance: Math.round((income - expense) * 100) / 100 }
}

export function groupScopeTotals(entries: MoneyEntry[]): {
  income: number
  expense: number
  balance: number
} {
  const income = groupIncome(entries)
  const expense = groupExpense(entries)
  return { income, expense, balance: Math.round((income - expense) * 100) / 100 }
}
