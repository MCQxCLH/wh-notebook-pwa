import {
  endOfMonth,
  endOfWeek,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { db, ensureSettings } from '../db/database'
import type { MoneyEntry, MoneyType } from '../db/types'
import { uid } from '../utils/id'
import { pushMoneyEntry } from '../sync/syncService'

const INCOME_CATS = ['salary', 'gift', 'other'] as const
const EXPENSE_CATS = ['food', 'rent', 'transport', 'fun', 'shopping', 'other'] as const

export function MoneyPage() {
  const { t } = useTranslation()
  const settings = useLiveQuery(() => ensureSettings(), [])
  const entries = useLiveQuery(
    () =>
      db.moneyEntries
        .filter((x) => !x.deleted)
        .toArray()
        .then((arr) => arr.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))),
    [],
  )
  const [showForm, setShowForm] = useState(false)
  const [type, setType] = useState<MoneyType>('expense')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState<string>('food')
  const [note, setNote] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))

  const currency = settings?.currency || 'HKD'
  const list = entries ?? []

  const totals = useMemo(() => {
    let income = 0
    let expense = 0
    for (const e of list) {
      if (e.type === 'income') income += e.amount
      else expense += e.amount
    }
    return { income, expense, balance: income - expense }
  }, [list])

  const weekMonth = useMemo(() => {
    const now = new Date()
    const ws = startOfWeek(now, { weekStartsOn: 1 })
    const we = endOfWeek(now, { weekStartsOn: 1 })
    const ms = startOfMonth(now)
    const me = endOfMonth(now)
    const sumRange = (from: Date, to: Date) => {
      let income = 0
      let expense = 0
      for (const e of list) {
        const d = parseISO(e.date)
        if (d >= from && d <= to) {
          if (e.type === 'income') income += e.amount
          else expense += e.amount
        }
      }
      return { income, expense }
    }
    return { week: sumRange(ws, we), month: sumRange(ms, me) }
  }, [list])

  const chartData = useMemo(() => {
    const map = new Map<string, { date: string; income: number; expense: number }>()
    for (const e of list) {
      const key = e.date.slice(0, 7)
      const cur = map.get(key) || { date: key, income: 0, expense: 0 }
      if (e.type === 'income') cur.income += e.amount
      else cur.expense += e.amount
      map.set(key, cur)
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-6)
  }, [list])

  function fmt(n: number) {
    return `${currency} ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  }

  async function save() {
    const n = Number(amount)
    if (!Number.isFinite(n) || n <= 0) return
    const now = new Date().toISOString()
    const entry: MoneyEntry = {
      id: uid(),
      type,
      amount: Math.round(n * 100) / 100,
      category,
      note: note.trim() || undefined,
      date,
      createdAt: now,
      updatedAt: now,
    }
    await db.moneyEntries.put(entry)
    await pushMoneyEntry(entry)
    setAmount('')
    setNote('')
    setShowForm(false)
  }

  async function remove(entry: MoneyEntry) {
    if (!confirm(t('common.confirmDelete'))) return
    const next = { ...entry, deleted: true, updatedAt: new Date().toISOString() }
    await db.moneyEntries.put(next)
    await pushMoneyEntry(next)
  }

  const cats = type === 'income' ? INCOME_CATS : EXPENSE_CATS

  return (
    <>
      <div className="card stack">
        <div className="row between">
          <h2 style={{ margin: 0 }}>{t('money.title')}</h2>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setType('expense')
              setCategory('food')
              setShowForm(true)
            }}
          >
            {t('money.add')}
          </button>
        </div>
        <div className="summary-grid">
          <div className="stat income">
            <div className="label">{t('money.totalIncome')}</div>
            <div className="value">{fmt(totals.income)}</div>
          </div>
          <div className="stat expense">
            <div className="label">{t('money.totalExpense')}</div>
            <div className="value">{fmt(totals.expense)}</div>
          </div>
          <div className="stat" style={{ gridColumn: '1 / -1' }}>
            <div className="label">{t('money.balance')}</div>
            <div className="value">{fmt(totals.balance)}</div>
          </div>
        </div>
        {settings ? (
          <div className="muted">
            {t('money.period')}: {settings.whStart} → {settings.whEnd}
          </div>
        ) : null}
      </div>

      <div className="card stack">
        <strong>{t('money.weekly')}</strong>
        <div className="row between muted">
          <span>{t('money.income')}</span>
          <span className="amount income">{fmt(weekMonth.week.income)}</span>
        </div>
        <div className="row between muted">
          <span>{t('money.expense')}</span>
          <span className="amount expense">{fmt(weekMonth.week.expense)}</span>
        </div>
      </div>

      <div className="card stack">
        <strong>{t('money.monthly')}</strong>
        <div className="row between muted">
          <span>{t('money.income')}</span>
          <span className="amount income">{fmt(weekMonth.month.income)}</span>
        </div>
        <div className="row between muted">
          <span>{t('money.expense')}</span>
          <span className="amount expense">{fmt(weekMonth.month.expense)}</span>
        </div>
      </div>

      {chartData.length > 0 ? (
        <div className="card stack">
          <strong>{t('money.chart')}</strong>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={40} />
                <Tooltip />
                <Bar dataKey="income" fill="#2f8f6b" name={t('money.income')} radius={4} />
                <Bar dataKey="expense" fill="#c45c5c" name={t('money.expense')} radius={4} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : null}

      <div className="card">
        {list.length === 0 ? (
          <div className="empty">{t('money.empty')}</div>
        ) : (
          list.map((e) => (
            <div key={e.id} className="money-item">
              <div>
                <div>
                  <strong>{t(`money.categories.${e.category}`, e.category)}</strong>
                </div>
                <div className="muted">
                  {e.date}
                  {e.note ? ` · ${e.note}` : ''}
                </div>
                <button
                  type="button"
                  className="btn danger small"
                  onClick={() => void remove(e)}
                >
                  {t('todos.delete')}
                </button>
              </div>
              <div className={`amount ${e.type}`}>
                {e.type === 'income' ? '+' : '-'}
                {fmt(e.amount)}
              </div>
            </div>
          ))
        )}
      </div>

      {showForm ? (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <div className="modal stack" onClick={(e) => e.stopPropagation()}>
            <h2>{t('money.add')}</h2>
            <div className="chip-row">
              <button
                type="button"
                className={`chip${type === 'expense' ? ' active' : ''}`}
                onClick={() => {
                  setType('expense')
                  setCategory('food')
                }}
              >
                {t('money.expense')}
              </button>
              <button
                type="button"
                className={`chip${type === 'income' ? ' active' : ''}`}
                onClick={() => {
                  setType('income')
                  setCategory('salary')
                }}
              >
                {t('money.income')}
              </button>
            </div>
            <div className="field">
              <label>{t('money.amount')}</label>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="field">
              <label>{t('money.category')}</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {cats.map((c) => (
                  <option key={c} value={c}>
                    {t(`money.categories.${c}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>{t('money.date')}</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="field">
              <label>{t('money.note')}</label>
              <input value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <div className="row">
              <button type="button" className="btn secondary grow" onClick={() => setShowForm(false)}>
                {t('todos.cancel')}
              </button>
              <button type="button" className="btn grow" onClick={() => void save()}>
                {t('todos.save')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

