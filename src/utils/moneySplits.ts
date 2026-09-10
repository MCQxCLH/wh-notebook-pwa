import type { EntryCurrency, MoneyEntry } from '../db/types'

export type EffectiveSplit = 'personal' | 'equal' | 'custom'

/** Resolve entry currency; legacy missing → fallback (settings default or HKD). */
export function entryCurrency(
  entry: MoneyEntry,
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
 * - Income: full amount if attributed to user, else 0.
 * - Expense personal: full if payer is user.
 * - Expense equal: amount / n.
 * - Expense custom: shares[userId] (or 0).
 */
export function shareForUser(
  entry: MoneyEntry,
  userId: string,
  opts?: { treatMissingPaidByAsUser?: boolean; partnerId?: string | null },
): number {
  const treatMissing = opts?.treatMissingPaidByAsUser !== false
  const paidBy = entry.paidById
  const isMine = paidBy === userId || (paidBy == null && treatMissing)

  if (entry.type === 'income') {
    return isMine ? entry.amount : 0
  }

  const mode = effectiveSplitMode(entry)
  if (mode === 'personal') {
    return isMine ? entry.amount : 0
  }

  if (mode === 'custom') {
    const shares = entry.shares || {}
    if (userId in shares) {
      return Math.round(Number(shares[userId]) * 100) / 100
    }
    // Legacy custom without this user — 0
    return 0
  }

  // equal
  const ids = entry.participantIds?.filter(Boolean) ?? []
  const n = ids.length >= 2 ? ids.length : 2
  if (ids.length > 0 && !ids.includes(userId)) {
    if (!(paidBy == null && treatMissing)) return 0
  }
  return Math.round((entry.amount / n) * 100) / 100
}

/** Share map for display / settlement. */
export function sharesForEntry(
  entry: MoneyEntry,
  meId: string,
  partnerId: string | null | undefined,
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
 * Net balance from shared (equal + custom) expenses only, for one currency slice.
 * Positive ⇒ partner owes me; negative ⇒ I owe partner.
 */
export function netBalance(
  entries: MoneyEntry[],
  meId: string,
  partnerId: string | null | undefined,
): number {
  let net = 0
  for (const e of entries) {
    if (e.deleted) continue
    if (e.type !== 'expense') continue
    if (!isSharedExpense(e)) continue

    const ids = participantIdsFor(e, meId, partnerId)
    const shareMap = sharesForEntry(e, meId, partnerId)
    const payer = e.paidById

    if (!payer) continue

    if (payer === meId) {
      for (const id of ids) {
        if (id !== meId) net += shareMap[id] ?? 0
      }
      // Implied partner when only me listed
      if (ids.length === 1 && partnerId) {
        net += shareMap[partnerId] ?? e.amount / 2
      }
    } else if (partnerId && payer === partnerId) {
      const myShare = shareMap[meId]
      if (myShare != null) net -= myShare
      else if (ids.includes(meId) || ids.length < 2) {
        net -= e.amount / Math.max(ids.length, 2)
      }
    } else {
      // Third-party payer
      if (ids.includes(meId)) net -= shareMap[meId] ?? 0
    }
  }
  return Math.round(net * 100) / 100
}

export function personalIncome(entries: MoneyEntry[], userId: string): number {
  let s = 0
  for (const e of entries) {
    if (e.deleted || e.type !== 'income') continue
    s += shareForUser(e, userId)
  }
  return Math.round(s * 100) / 100
}

export function personalExpense(entries: MoneyEntry[], userId: string): number {
  let s = 0
  for (const e of entries) {
    if (e.deleted || e.type !== 'expense') continue
    s += shareForUser(e, userId)
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
): { income: number; expense: number; balance: number } {
  const income = meId ? personalIncome(entries, meId) : groupIncome(entries)
  const expense = meId ? personalExpense(entries, meId) : groupExpense(entries)
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
