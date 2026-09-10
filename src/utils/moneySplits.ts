import type { MoneyEntry } from '../db/types'

/** Treat missing splitMode as personal (legacy). */
export function effectiveSplitMode(entry: MoneyEntry): 'personal' | 'shared' {
  return entry.splitMode === 'shared' ? 'shared' : 'personal'
}

/**
 * Personal share for a user.
 * - Income: full amount if attributed to user (paidById), else 0.
 *   Missing paidById → attribute to currentUserId (legacy / local data).
 * - Expense personal: full amount if paidBy is user (or missing → current user).
 * - Expense shared: amount / n participants (equal); if no participants, /2.
 */
export function shareForUser(
  entry: MoneyEntry,
  userId: string,
  opts?: { treatMissingPaidByAsUser?: boolean },
): number {
  const treatMissing = opts?.treatMissingPaidByAsUser !== false
  const paidBy = entry.paidById
  const isMine =
    paidBy === userId || (paidBy == null && treatMissing)

  if (entry.type === 'income') {
    return isMine ? entry.amount : 0
  }

  const mode = effectiveSplitMode(entry)
  if (mode === 'personal') {
    return isMine ? entry.amount : 0
  }

  // shared expense
  const ids = entry.participantIds?.filter(Boolean) ?? []
  const n = ids.length >= 2 ? ids.length : 2
  if (ids.length > 0 && !ids.includes(userId)) {
    // Not a participant — no share (unless missing paidBy legacy: still split for me)
    if (!(paidBy == null && treatMissing)) return 0
  }
  return Math.round((entry.amount / n) * 100) / 100
}

/** Full amount for group totals. */
export function groupAmount(entry: MoneyEntry): number {
  return entry.amount
}

/**
 * Net balance from shared expenses only.
 * Positive ⇒ partner owes me; negative ⇒ I owe partner.
 * Logic: for each shared expense, each participant owes amount/n.
 * The payer paid the full amount, so others owe the payer their shares.
 * For two people: if I paid, partner owes amount/2; if partner paid, I owe amount/2.
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
    if (effectiveSplitMode(e) !== 'shared') continue

    const ids =
      e.participantIds && e.participantIds.length >= 2
        ? e.participantIds
        : partnerId
          ? [meId, partnerId]
          : [meId]
    const n = Math.max(ids.length, 2)
    const share = e.amount / n
    const payer = e.paidById

    // Each non-payer owes the payer their share
    if (payer === meId) {
      // Partner (and others) owe me
      for (const id of ids) {
        if (id !== meId) net += share
      }
      // If only me in ids but shared with implied partner
      if (ids.length === 1 && partnerId) net += share
    } else if (payer && payer === partnerId) {
      if (ids.includes(meId) || ids.length < 2) net -= share
    } else if (!payer) {
      // Unknown payer — skip from settlement
      continue
    } else {
      // Third-party payer: if I'm a participant I owe them; if partner paid somehow handled above
      if (ids.includes(meId)) net -= share
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
