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
import type { EntryCurrency, MoneyEntry, MoneyType, SplitMode } from '../db/types'
import { uid } from '../utils/id'
import {
  effectiveSplitMode,
  entryCurrency,
  filterByCurrency,
  groupExpense,
  groupIncome,
  groupScopeTotals,
  netBalance,
  personalExpense,
  personalIncome,
  shareForUser,
  sharesForEntry,
} from '../utils/moneySplits'
import { RoomMembersList } from '../components/RoomMembersList'
import { pushMoneyEntry } from '../sync/syncService'

const INCOME_CATS = ['salary', 'gift', 'other'] as const
const EXPENSE_CATS = ['food', 'rent', 'transport', 'fun', 'shopping', 'other'] as const
const CURRENCIES: EntryCurrency[] = ['HKD', 'AUD']

type FormSplit = 'personal' | 'equal' | 'custom'

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
  const [formCurrency, setFormCurrency] = useState<EntryCurrency>('HKD')
  const [splitMode, setSplitMode] = useState<FormSplit>('personal')
  const [paidBy, setPaidBy] = useState<'me' | 'partner'>('me')
  const [myShareInput, setMyShareInput] = useState('')
  const [partnerShareInput, setPartnerShareInput] = useState('')
  const [chartCurrency, setChartCurrency] = useState<EntryCurrency>('HKD')

  const defaultCurrency: EntryCurrency =
    (settings?.currency || 'HKD').toUpperCase() === 'AUD' ? 'AUD' : 'HKD'
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

  function slice(currency: EntryCurrency) {
    return filterByCurrency(list, currency, defaultCurrency)
  }

  const dualTotals = useMemo(() => {
    const build = (currency: EntryCurrency) => {
      const ranged = filterByCurrency(list, currency, defaultCurrency)
      const g = groupScopeTotals(ranged)
      const pIncome = meId ? personalIncome(ranged, meId) : g.income
      const pExpense = meId ? personalExpense(ranged, meId) : g.expense
      return {
        group: g,
        personal: {
          income: pIncome,
          expense: pExpense,
          balance: Math.round((pIncome - pExpense) * 100) / 100,
        },
        settlement: meId ? netBalance(ranged, meId, partnerId) : 0,
      }
    }
    return { HKD: build('HKD'), AUD: build('AUD') }
  }, [list, meId, partnerId, defaultCurrency])

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
    const sum = (from: Date, to: Date, currency: EntryCurrency) => {
      const ranged = filterByCurrency(list, currency, defaultCurrency).filter((e) =>
        inRange(e, from, to),
      )
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
    return {
      week: { HKD: sum(ws, we, 'HKD'), AUD: sum(ws, we, 'AUD') },
      month: { HKD: sum(ms, me, 'HKD'), AUD: sum(ms, me, 'AUD') },
    }
  }, [list, meId, defaultCurrency])

  const chartData = useMemo(() => {
    const ranged = slice(chartCurrency)
    const map = new Map<string, { date: string; income: number; expense: number }>()
    for (const e of ranged) {
      const key = e.date.slice(0, 7)
      const cur = map.get(key) || { date: key, income: 0, expense: 0 }
      if (e.type === 'income') cur.income += e.amount
      else cur.expense += e.amount
      map.set(key, cur)
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-6)
  }, [list, chartCurrency, defaultCurrency])

  function fmt(n: number, currency: string) {
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
    setFormCurrency(defaultCurrency)
    setMyShareInput('')
    setPartnerShareInput('')
    setShowForm(true)
  }

  function onAmountChange(raw: string) {
    setAmount(raw)
    if (splitMode === 'custom') {
      const total = Number(raw)
      const mine = Number(myShareInput)
      if (Number.isFinite(total) && total > 0 && Number.isFinite(mine) && myShareInput !== '') {
        setPartnerShareInput(String(Math.round((total - mine) * 100) / 100))
      }
    }
  }

  function onMyShareChange(raw: string) {
    setMyShareInput(raw)
    const total = Number(amount)
    const mine = Number(raw)
    if (Number.isFinite(total) && total > 0 && Number.isFinite(mine)) {
      setPartnerShareInput(String(Math.round((total - mine) * 100) / 100))
    }
  }

  function onPartnerShareChange(raw: string) {
    setPartnerShareInput(raw)
    const total = Number(amount)
    const theirs = Number(raw)
    if (Number.isFinite(total) && total > 0 && Number.isFinite(theirs)) {
      setMyShareInput(String(Math.round((total - theirs) * 100) / 100))
    }
  }

  function setSplitAndInit(mode: FormSplit) {
    setSplitMode(mode)
    if (mode === 'custom') {
      const total = Number(amount)
      if (Number.isFinite(total) && total > 0) {
        const half = Math.round((total / 2) * 100) / 100
        setMyShareInput(String(half))
        setPartnerShareInput(String(Math.round((total - half) * 100) / 100))
      } else {
        setMyShareInput('')
        setPartnerShareInput('')
      }
    }
  }

  async function save() {
    const n = Number(amount)
    if (!Number.isFinite(n) || n <= 0 || !settings?.userId) return
    const now = new Date().toISOString()
    const payerIsMe = paidBy === 'me'
    const paidById = payerIsMe ? settings.userId : partnerId || 'partner'
    const paidByName = payerIsMe ? meName : partnerLabel

    let mode: SplitMode = 'personal'
    if (type === 'expense') {
      if (splitMode === 'equal') mode = 'equal'
      else if (splitMode === 'custom') mode = 'custom'
      else mode = 'personal'
    }

    const pidPartner = partnerId || 'partner'
    const participantIds =
      mode === 'equal' || mode === 'custom'
        ? [settings.userId, pidPartner]
        : [paidById]
    const participantNames =
      mode === 'equal' || mode === 'custom' ? [meName, partnerLabel] : [paidByName]

    let shares: Record<string, number> | undefined
    if (mode === 'custom') {
      const mine = Number(myShareInput)
      const theirs = Number(partnerShareInput)
      if (!Number.isFinite(mine) || !Number.isFinite(theirs) || mine < 0 || theirs < 0) return
      const sum = Math.round((mine + theirs) * 100) / 100
      if (Math.abs(sum - n) > 0.02) {
        alert(t('money.shareSumError', { total: fmt(n, formCurrency), sum: fmt(sum, formCurrency) }))
        return
      }
      shares = {
        [settings.userId]: Math.round(mine * 100) / 100,
        [pidPartner]: Math.round(theirs * 100) / 100,
      }
    }

    const entry: MoneyEntry = {
      id: uid(),
      type,
      amount: Math.round(n * 100) / 100,
      category,
      note: note.trim() || undefined,
      date,
      createdAt: now,
      updatedAt: now,
      currency: formCurrency,
      paidById,
      paidByName,
      splitMode: mode,
      participantIds,
      participantNames,
      shares,
    }
    await db.moneyEntries.put(entry)
    try {
      await pushMoneyEntry(entry)
    } catch {
      alert(t('money.syncPushFailed'))
    }
    setAmount('')
    setNote('')
    setMyShareInput('')
    setPartnerShareInput('')
    setShowForm(false)
  }

  async function remove(entry: MoneyEntry) {
    if (!confirm(t('common.confirmDelete'))) return
    const next = { ...entry, deleted: true, updatedAt: new Date().toISOString() }
    await db.moneyEntries.put(next)
    await pushMoneyEntry(next)
  }

  const cats = type === 'income' ? INCOME_CATS : EXPENSE_CATS

  function CurrencyTotals({
    currency,
    group,
    personal,
  }: {
    currency: EntryCurrency
    group: { income: number; expense: number; balance: number }
    personal: { income: number; expense: number; balance: number }
  }) {
    return (
      <div className="currency-block">
        <div className="currency-heading">{currency}</div>
        <div className="scope-section">
          <div className="scope-heading">{t('money.groupScope')}</div>
          <div className="summary-grid">
            <div className="stat income">
              <div className="label">{t('money.totalIncome')}</div>
              <div className="value">{fmt(group.income, currency)}</div>
            </div>
            <div className="stat expense">
              <div className="label">{t('money.totalExpense')}</div>
              <div className="value">{fmt(group.expense, currency)}</div>
            </div>
            <div className="stat" style={{ gridColumn: '1 / -1' }}>
              <div className="label">{t('money.balance')}</div>
              <div className="value">{fmt(group.balance, currency)}</div>
            </div>
          </div>
        </div>
        <div className="scope-section">
          <div className="scope-heading">{t('money.personalScope')}</div>
          <div className="summary-grid">
            <div className="stat income">
              <div className="label">{t('money.totalIncome')}</div>
              <div className="value">{fmt(personal.income, currency)}</div>
            </div>
            <div className="stat expense">
              <div className="label">{t('money.totalExpense')}</div>
              <div className="value">{fmt(personal.expense, currency)}</div>
            </div>
            <div className="stat" style={{ gridColumn: '1 / -1' }}>
              <div className="label">{t('money.balance')}</div>
              <div className="value">{fmt(personal.balance, currency)}</div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  function ScopeBlock({
    title,
    income,
    expense,
    currency,
  }: {
    title: string
    income: number
    expense: number
    currency: string
  }) {
    return (
      <div className="scope-block">
        <div className="scope-label">{title}</div>
        <div className="row between muted">
          <span>{t('money.income')}</span>
          <span className="amount income">{fmt(income, currency)}</span>
        </div>
        <div className="row between muted">
          <span>{t('money.expense')}</span>
          <span className="amount expense">{fmt(expense, currency)}</span>
        </div>
      </div>
    )
  }

  function PeriodCard({
    title,
    data,
  }: {
    title: string
    data: {
      HKD: {
        group: { income: number; expense: number }
        personal: { income: number; expense: number }
      }
      AUD: {
        group: { income: number; expense: number }
        personal: { income: number; expense: number }
      }
    }
  }) {
    return (
      <div className="card stack">
        <strong>{title}</strong>
        {CURRENCIES.map((c) => (
          <div key={c} className="currency-block compact">
            <div className="currency-heading">{c}</div>
            <ScopeBlock
              title={t('money.groupScope')}
              income={data[c].group.income}
              expense={data[c].group.expense}
              currency={c}
            />
            <ScopeBlock
              title={t('money.personalScope')}
              income={data[c].personal.income}
              expense={data[c].personal.expense}
              currency={c}
            />
          </div>
        ))}
      </div>
    )
  }

  function SettlementBlock({ currency }: { currency: EntryCurrency }) {
    const settlement = dualTotals[currency].settlement
    return (
      <div className="currency-block compact">
        <div className="currency-heading">{currency}</div>
        {Math.abs(settlement) < 0.005 ? (
          <div className="muted">{t('money.settled')}</div>
        ) : settlement > 0 ? (
          <div className="settlement-line owes-you">
            {t('money.owesYou', { name: partnerLabel, amount: fmt(settlement, currency) })}
          </div>
        ) : (
          <div className="settlement-line you-owe">
            {t('money.youOwe', {
              name: partnerLabel,
              amount: fmt(Math.abs(settlement), currency),
            })}
          </div>
        )}
      </div>
    )
  }

  function entryMeta(e: MoneyEntry) {
    const mode = effectiveSplitMode(e)
    const cur = entryCurrency(e, defaultCurrency)
    const payer = e.paidByName || (e.paidById === meId ? meName : partnerLabel)
    if (e.type === 'income') {
      return t('money.receivedBy', { name: payer })
    }
    if (mode === 'equal') {
      const myShare = meId ? shareForUser(e, meId) : e.amount / 2
      return `${t('money.sharedEqual')} · ${t('money.paidBy')}: ${payer} · ${t('money.myShare')}: ${fmt(myShare, cur)}`
    }
    if (mode === 'custom') {
      const map = sharesForEntry(e, meId || 'me', partnerId)
      const myAmt = meId ? map[meId] ?? 0 : 0
      const partnerKey = partnerId || 'partner'
      const partnerAmt = map[partnerKey] ?? Object.entries(map).find(([id]) => id !== meId)?.[1] ?? 0
      return `${t('money.sharedCustom')} · ${t('money.paidBy')}: ${payer} · ${t('money.myShare')}: ${fmt(myAmt, cur)} · ${partnerLabel}: ${fmt(partnerAmt, cur)}`
    }
    return `${t('money.personal')} · ${t('money.paidBy')}: ${payer}`
  }

  function splitTag(e: MoneyEntry) {
    if (e.type !== 'expense') return null
    const mode = effectiveSplitMode(e)
    if (mode === 'equal') return <span className="tag shared">{t('money.sharedEqual')}</span>
    if (mode === 'custom') return <span className="tag shared custom">{t('money.sharedCustom')}</span>
    return <span className="tag personal">{t('money.personal')}</span>
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
        <div className="muted" style={{ fontSize: '0.78rem' }}>
          {t('money.dualCurrencyHint')}
        </div>

        {CURRENCIES.map((c) => (
          <CurrencyTotals
            key={c}
            currency={c}
            group={dualTotals[c].group}
            personal={dualTotals[c].personal}
          />
        ))}

        {settings ? (
          <div className="muted">
            {t('money.period')}: {settings.whStart} → {settings.whEnd}
          </div>
        ) : null}
      </div>

      <div className="card stack settlement-card">
        <strong>{t('money.settlement')}</strong>
        <div className="muted" style={{ fontSize: '0.78rem' }}>
          {t('money.settlementHint')}
        </div>
        {CURRENCIES.map((c) => (
          <SettlementBlock key={c} currency={c} />
        ))}
      </div>

      {settings?.roomCode ? (
        <div className="card stack">
          <strong>{t('money.groupMembers')}</strong>
          <RoomMembersList members={memberList} meId={meId} />
        </div>
      ) : null}

      <PeriodCard title={t('money.weekly')} data={weekMonth.week} />
      <PeriodCard title={t('money.monthly')} data={weekMonth.month} />

      <div className="card stack">
        <strong>{t('money.chart')}</strong>
        <div className="chip-row">
          {CURRENCIES.map((c) => (
            <button
              key={c}
              type="button"
              className={`chip${chartCurrency === c ? ' active' : ''}`}
              onClick={() => setChartCurrency(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="muted" style={{ fontSize: '0.78rem' }}>
          {t('money.chartHint')}
        </div>
        {chartData.length > 0 ? (
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
        ) : (
          <div className="empty">{t('money.noChartData')}</div>
        )}
      </div>

      <div className="card">
        {list.length === 0 ? (
          <div className="empty">{t('money.empty')}</div>
        ) : (
          list.map((e) => {
            const cur = entryCurrency(e, defaultCurrency)
            return (
              <div key={e.id} className="money-item">
                <div>
                  <div>
                    <strong>{t(`money.categories.${e.category}`, e.category)}</strong>
                    <span className="tag currency-tag">{cur}</span>
                    {splitTag(e)}
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
                  {fmt(e.amount, cur)}
                </div>
              </div>
            )
          })
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

            <div className="field">
              <label>{t('money.entryCurrency')}</label>
              <div className="chip-row">
                {CURRENCIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`chip${formCurrency === c ? ' active' : ''}`}
                    onClick={() => setFormCurrency(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {type === 'expense' ? (
              <div className="field">
                <label>{t('money.splitMode')}</label>
                <div className="chip-row">
                  <button
                    type="button"
                    className={`chip${splitMode === 'personal' ? ' active' : ''}`}
                    onClick={() => setSplitAndInit('personal')}
                  >
                    {t('money.personal')}
                  </button>
                  <button
                    type="button"
                    className={`chip${splitMode === 'equal' ? ' active' : ''}`}
                    onClick={() => setSplitAndInit('equal')}
                  >
                    {t('money.sharedEqual')}
                  </button>
                  <button
                    type="button"
                    className={`chip${splitMode === 'custom' ? ' active' : ''}`}
                    onClick={() => setSplitAndInit('custom')}
                  >
                    {t('money.sharedCustom')}
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
                onChange={(e) => onAmountChange(e.target.value)}
                placeholder="0.00"
              />
            </div>

            {type === 'expense' && splitMode === 'custom' ? (
              <>
                <div className="field">
                  <label>
                    {t('money.myShare')} ({meName})
                  </label>
                  <input
                    inputMode="decimal"
                    value={myShareInput}
                    onChange={(e) => onMyShareChange(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div className="field">
                  <label>
                    {t('money.partnerShare')} ({partnerLabel})
                  </label>
                  <input
                    inputMode="decimal"
                    value={partnerShareInput}
                    onChange={(e) => onPartnerShareChange(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div className="muted" style={{ fontSize: '0.78rem' }}>
                  {t('money.customShareHint')}
                </div>
              </>
            ) : null}

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

