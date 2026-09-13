import type { MoneyEntry, Settlement } from '../db/types'
import { entryCurrency } from './moneySplits'

function csvEscape(v: string | number | undefined | null): string {
  const s = v == null ? '' : String(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function downloadMoneyCsv(
  entries: MoneyEntry[],
  settlements: Settlement[],
  fallbackCurrency = 'HKD',
): void {
  const rows: string[] = []
  rows.push(
    [
      'kind',
      'date',
      'currency',
      'type',
      'amount',
      'category',
      'note',
      'paidBy / from',
      'to',
      'splitMode',
    ].join(','),
  )

  for (const e of entries) {
    if (e.deleted) continue
    rows.push(
      [
        'money',
        csvEscape(e.date),
        csvEscape(entryCurrency(e, fallbackCurrency)),
        csvEscape(e.type),
        csvEscape(e.amount),
        csvEscape(e.category),
        csvEscape(e.note),
        csvEscape(e.paidByName || e.paidById),
        '',
        csvEscape(e.splitMode || 'personal'),
      ].join(','),
    )
  }

  for (const s of settlements) {
    if (s.deleted) continue
    rows.push(
      [
        'settlement',
        csvEscape(s.date),
        csvEscape(entryCurrency(s, fallbackCurrency)),
        'payment',
        csvEscape(s.amount),
        'settlement',
        csvEscape(s.note),
        csvEscape(s.fromUserName || s.fromUserId),
        csvEscape(s.toUserName || s.toUserId),
        '',
      ].join(','),
    )
  }

  const blob = new Blob(['\uFEFF' + rows.join('\n')], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `wh-notebook-money-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
