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
import type { MoneyEntry, MoneyType, SplitMode } from '../db/types'
import { uid } from '../utils/id'
import {
  effectiveSplitMode,
  groupExpense,
  groupIncome,
  netBalance,
  personalExpense,
  personalIncome,
  shareForUser,
} from '../utils/moneySplits'
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
        .then((arr) =>
          arr.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
        ),
    [],
  )
  const members = useLiveQuery(() => db.roomMembers.toArray(), [])

  const [showForm, setShowForm] = useState(false)
  const [type, setType] = useState<MoneyType>('expense')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState<string>('food')
  const [note, setNote] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [splitMode, setSplitMode] = useState<SplitMode>('personal')
  const [paidBy, setPaidBy] = useState<'me' | 'partner'>('me')

  const currency = settings?.currency || 'HKD'
  const meId = settings?.userId || ''
  const meName = settings?.displayName || 'Traveler'
  const partnerName = settings?.partnerName?.trim() || t('money.partner')
  const list = entries ?? []
  const memberList = members ?? []

  const partnerMember = useMemo(() => {
    if (!meId) return undefined
    return memberList.find((m) => m.id !== meId)
  }, [memberList, meId])

  const partnerId = partnerMember?.id || null
  const partnerLabel = partnerMember?.displayName || partnerName

  const totals = useMemo(() => {
    const gIncome = groupIncome(list)
    const gExpense = groupExpense(list)
    const pIncome = meId ? personalIncome(list, meId) : gIncome
    const pExpense = meId ? personalExpense(list, meId) : gExpense
    return {
      group: { income: gIncome, expense: gExpense, balance: gIncome - gExpense },
      personal: { income: pIncome, expense: pExpense, balance: pIncome - pExpense },
    }
  }, [list, meId])

  const weekMonth = useMemo(() => {
    const now = new Date()
    const ws = startOfWeek(now, { weekStartsOn: 1 })
    const we = endOfWeek(now, { weekStartsOn: 1 })
    const ms = startOfMonth(now)
    const me = endOfMonth(now)
    const inRange = (e: MoneyEntry, from: Date, to: Date) => {
      const d = parseISO(e.date)
      return d >= from && d <= to
    }
    const sum = (from: Date, to: Date) => {
      const ranged = list.filter((e) => inRange(e, from, to))
      return {
        group: {
          income: groupIncome(ranged),
          expense: groupExpense(ranged),
        },
        personal: {
          income: meId ? personalIncome(ranged, meId) : groupIncome(ranged),
          expense: meId ? personalExpense(ranged, meId) : groupExpense(ranged),
        },
      }
    }
    return { week: sum(ws, we), month: sum(ms, me) }
  }, [list, meId])

  const settlement = useMemo(() => {
    if (!meId) return 0
    return netBalance(list, meId, partnerId)
  }, [list, meId, partnerId])

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

  function openForm(initial: MoneyType) {
    setType(initial)
    setCategory(initial === 'income' ? 'salary' : 'food')
    setSplitMode('personal')
    setPaidBy('me')
    setAmount('')
    setNote('')
    setDate(new Date().toISOString().slice(0, 10))
    setShowForm(true)
  }

  async function save() {
    const n = Number(amount)
    if (!Number.isFinite(n) || n <= 0 || !settings?.userId) return
    const now = new Date().toISOString()
    const payerIsMe = paidBy === 'me'
    const paidById = payerIsMe ? settings.userId : partnerId || 'partner'
    const paidByName = payerIsMe ? meName : partnerLabel
    const mode: SplitMode = type === 'income' ? 'personal' : splitMode

    const participantIds =
      mode === 'shared'
        ? [settings.userId, partnerId || 'partner'].filter(Boolean)
        : [paidById]
    const participantNames =
      mode === 'shared' ? [meName, partnerLabel] : [paidByName]

    const entry: MoneyEntry = {
      id: uid(),
      type,
      amount: Math.round(n * 100) / 100,
      category,
      note: note.trim() || undefined,
      date,
      createdAt: now,
      updatedAt: now,
      paidById,
      paidByName,
      splitMode: mode,
      participantIds,
      participantNames,
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

  function ScopeBlock({
    title,
    income,
    expense,
  }: {
    title: string
    income: number
    expense: number
  }) {
    return (
      <div className="scope-block">
        <div className="scope-label">{title}</div>
        <div className="row between muted">
          <span>{t('money.income')}</span>
          <span className="amount income">{fmt(income)}</span>
        </div>
        <div className="row between muted">
          <span>{t('money.expense')}</span>
          <span className="amount expense">{fmt(expense)}</span>
        </div>
      </div>
    )
  }

  function entryMeta(e: MoneyEntry) {
    const mode = effectiveSplitMode(e)
    const payer = e.paidByName || (e.paidById === meId ? meName : partnerLabel)
    if (e.type === 'income') {
      return t('money.receivedBy', { name: payer })
    }
    if (mode === 'shared') {
      const myShare = meId ? shareForUser(e, meId) : e.amount / 2
      return `${t('money.shared')} · ${t('money.paidBy')}: ${payer} · ${t('money.myShare')}: ${fmt(myShare)}`
    }
    return `${t('money.personal')} · ${t('money.paidBy')}: ${payer}`
  }

  return (
    <>
      <div className="card stack">
        <div className="row between">
          <h2 style={{ margin: 0 }}>{t('money.title')}</h2>
          <button type="button" className="btn" onClick={() => openForm('expense')}>
            {t('money.add')}
          </button>
        </div>

        <div className="scope-section">
          <div className="scope-heading">{t('money.groupScope')}</div>
          <div className="summary-grid">
            <div className="stat income">
              <div className="label">{t('money.totalIncome')}</div>
              <div className="value">{fmt(totals.group.income)}</div>
            </div>
            <div className="stat expense">
              <div className="label">{t('money.totalExpense')}</div>
              <div className="value">{fmt(totals.group.expense)}</div>
            </div>
            <div className="stat" style={{ gridColumn: '1 / -1' }}>
              <div className="label">{t('money.balance')}</div>
              <div className="value">{fmt(totals.group.balance)}</div>
            </div>
          </div>
        </div>

        <div className="scope-section">
          <div className="scope-heading">{t('money.personalScope')}</div>
          <div className="summary-grid">
            <div className="stat income">
              <div className="label">{t('money.totalIncome')}</div>
              <div className="value">{fmt(totals.personal.income)}</div>
            </div>
            <div className="stat expense">
              <div className="label">{t('money.totalExpense')}</div>
              <div className="value">{fmt(totals.personal.expense)}</div>
            </div>
            <div className="stat" style={{ gridColumn: '1 / -1' }}>
              <div className="label">{t('money.balance')}</div>
              <div className="value">{fmt(totals.personal.balance)}</div>
            </div>
          </div>
        </div>

        {settings ? (
          <div className="muted">
            {t('money.period')}: {settings.whStart} → {settings.whEnd}
          </div>
        ) : null}
      </div>

      <div className="card stack settlement-card">
        <strong>{t('money.settlement')}</strong>
        {Math.abs(settlement) < 0.005 ? (
          <div className="muted">{t('money.settled')}</div>
        ) : settlement > 0 ? (
          <div className="settlement-line owes-you">
            {t('money.owesYou', { name: partnerLabel, amount: fmt(settlement) })}
          </div>
        ) : (
          <div className="settlement-line you-owe">
            {t('money.youOwe', { name: partnerLabel, amount: fmt(Math.abs(settlement)) })}
          </div>
        )}
        <div className="muted" style={{ fontSize: '0.78rem' }}>
          {t('money.settlementHint')}
        </div>
      </div>

      <div className="card stack">
        <strong>{t('money.weekly')}</strong>
        <ScopeBlock
          title={t('money.groupScope')}
          income={weekMonth.week.group.income}
          expense={weekMonth.week.group.expense}
        />
        <ScopeBlock
          title={t('money.personalScope')}
          income={weekMonth.week.personal.income}
          expense={weekMonth.week.personal.expense}
        />
      </div>

      <div className="card stack">
        <strong>{t('money.monthly')}</strong>
        <ScopeBlock
          title={t('money.groupScope')}
          income={weekMonth.month.group.income}
          expense={weekMonth.month.group.expense}
        />
        <ScopeBlock
          title={t('money.personalScope')}
          income={weekMonth.month.personal.income}
          expense={weekMonth.month.personal.expense}
        />
      </div>

      {chartData.length > 0 ? (
        <div className="card stack">
          <strong>{t('money.chart')}</strong>
          <div className="muted" style={{ fontSize: '0.78rem' }}>
            {t('money.chartHint')}
          </div>
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
                  {effectiveSplitMode(e) === 'shared' && e.type === 'expense' ? (
                    <span className="tag shared">{t('money.shared')}</span>
                  ) : (
                    <span className="tag personal">{t('money.personal')}</span>
                  )}
                </div>
                <div className="muted">
                  {e.date}
                  {e.note ? ` · ${e.note}` : ''}
                </div>
                <div className="muted" style={{ fontSize: '0.78rem' }}>
                  {entryMeta(e)}
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
                  setSplitMode('personal')
                }}
              >
                {t('money.income')}
              </button>
            </div>

            {type === 'expense' ? (
              <div className="field">
                <label>{t('money.splitMode')}</label>
                <div className="chip-row">
                  <button
                    type="button"
                    className={`chip${splitMode === 'personal' ? ' active' : ''}`}
                    onClick={() => setSplitMode('personal')}
                  >
                    {t('money.personal')}
                  </button>
                  <button
                    type="button"
                    className={`chip${splitMode === 'shared' ? ' active' : ''}`}
                    onClick={() => setSplitMode('shared')}
                  >
                    {t('money.shared')}
                  </button>
                </div>
              </div>
            ) : null}

            <div className="field">
              <label>{type === 'income' ? t('money.receivedByLabel') : t('money.paidBy')}</label>
              <div className="chip-row">
                <button
                  type="button"
                  className={`chip${paidBy === 'me' ? ' active' : ''}`}
                  onClick={() => setPaidBy('me')}
                >
                  {t('money.me')} ({meName})
                </button>
                <button
                  type="button"
                  className={`chip${paidBy === 'partner' ? ' active' : ''}`}
                  onClick={() => setPaidBy('partner')}
                >
                  {t('money.partner')} ({partnerLabel})
                </button>
              </div>
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
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
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
