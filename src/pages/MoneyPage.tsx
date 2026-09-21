import {
  endOfMonth,
  endOfWeek,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
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
import type {
  EntryCurrency,
  MoneyEntry,
  MoneyType,
  Settlement,
  SplitMode,
} from '../db/types'
import { uid } from '../utils/id'
import {
  buildAliasSets,
  idsEquivalent,
  memberLabel,
  resolvePartnerMember,
  shareAmountFromMap,
} from '../utils/identity'
import {
  effectiveSplitMode,
  entryCurrency,
  filterByCurrency,
  filterSettlementsByCurrency,
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
import { pushMoneyEntry, pushSettlement } from '../sync/syncService'
import { downloadMoneyCsv } from '../utils/exportCsv'

const INCOME_CATS = ['salary', 'gift', 'other'] as const
const EXPENSE_CATS = ['food', 'rent', 'transport', 'fun', 'shopping', 'other'] as const
const CURRENCIES: EntryCurrency[] = ['HKD', 'AUD']
const LAST_CURRENCY_KEY = 'wh-last-currency'

type FormSplit = 'personal' | 'equal' | 'custom'

function readLastCurrency(fallback: EntryCurrency): EntryCurrency {
  try {
    const v = localStorage.getItem(LAST_CURRENCY_KEY)?.toUpperCase()
    if (v === 'AUD' || v === 'HKD') return v
  } catch {
    /* ignore */
  }
  return fallback
}

function rememberCurrency(c: EntryCurrency) {
  try {
    localStorage.setItem(LAST_CURRENCY_KEY, c)
  } catch {
    /* ignore */
  }
}

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
  const settlements = useLiveQuery(
    () =>
      db.settlements
        .filter((x) => !x.deleted)
        .toArray()
        .then((arr) =>
          arr.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
        ),
    [],
  )
  const members = useLiveQuery(
    () => db.roomMembers.filter((m) => !m.deleted).toArray(),
    [],
  )

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingCreatedAt, setEditingCreatedAt] = useState<string | null>(null)
  const [showSettleForm, setShowSettleForm] = useState(false)
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
  const [preferredPartnerId, setPreferredPartnerId] = useState<string | null>(null)

  // Settlement form
  const [settleAmount, setSettleAmount] = useState('')
  const [settleCurrency, setSettleCurrency] = useState<EntryCurrency>('HKD')
  const [settleFrom, setSettleFrom] = useState<'me' | 'partner'>('me')
  const [settleDate, setSettleDate] = useState(new Date().toISOString().slice(0, 10))
  const [settleNote, setSettleNote] = useState('')

  const defaultCurrency: EntryCurrency =
    (settings?.currency || 'HKD').toUpperCase() === 'AUD' ? 'AUD' : 'HKD'
  const meId = settings?.userId || ''
  const meName = settings?.displayName || 'Traveler'
  const partnerName = settings?.partnerName?.trim() || t('money.partner')
  const list = entries ?? []
  const settleList = settlements ?? []
  const memberList = members ?? []

  const aliasMap = useMemo(
    () => buildAliasSets({ members: memberList, entries: list }),
    [memberList, list],
  )

  const idOpts = useMemo(
    () => ({ aliasMap, members: memberList, entries: list }),
    [aliasMap, memberList, list],
  )

  useEffect(() => {
    if (settings) {
      const last = readLastCurrency(defaultCurrency)
      setFormCurrency(last)
      setSettleCurrency(last)
      setChartCurrency(last)
    }
  }, [settings?.currency])

  const partnerResolution = useMemo(() => {
    if (!meId) {
      return { partner: null, candidates: [] as typeof memberList, ambiguous: false }
    }
    return resolvePartnerMember(memberList, meId, {
      partnerName: settings?.partnerName,
      entries: list,
      settlements: settleList,
      aliasMap,
      preferredPartnerId,
    })
  }, [
    memberList,
    meId,
    settings?.partnerName,
    list,
    settleList,
    aliasMap,
    preferredPartnerId,
  ])

  const partnerMember = partnerResolution.partner
  const partnerId = partnerMember?.id || null
  const partnerLabel = partnerMember
    ? memberLabel(partnerMember, {
        showEmail:
          partnerResolution.candidates.filter(
            (c) =>
              c.displayName.trim().toLowerCase() ===
              partnerMember.displayName.trim().toLowerCase(),
          ).length > 1,
      })
    : partnerName

  const recentCategories = useMemo(() => {
    const seen: string[] = []
    for (const e of list) {
      if (e.type !== type) continue
      if (!seen.includes(e.category)) seen.push(e.category)
      if (seen.length >= 4) break
    }
    return seen
  }, [list, type])

  function slice(currency: EntryCurrency) {
    return filterByCurrency(list, currency, defaultCurrency)
  }

  const dualTotals = useMemo(() => {
    const build = (currency: EntryCurrency) => {
      const ranged = filterByCurrency(list, currency, defaultCurrency)
      const settles = filterSettlementsByCurrency(settleList, currency, defaultCurrency)
      const g = groupScopeTotals(ranged)
      const pIncome = meId ? personalIncome(ranged, meId, idOpts) : g.income
      const pExpense = meId ? personalExpense(ranged, meId, idOpts) : g.expense
      return {
        group: g,
        personal: {
          income: pIncome,
          expense: pExpense,
          balance: Math.round((pIncome - pExpense) * 100) / 100,
        },
        settlement: meId ? netBalance(ranged, meId, partnerId, settles, idOpts) : 0,
      }
    }
    return { HKD: build('HKD'), AUD: build('AUD') }
  }, [list, settleList, meId, partnerId, defaultCurrency, idOpts])

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
          income: meId ? personalIncome(ranged, meId, idOpts) : groupIncome(ranged),
          expense: meId ? personalExpense(ranged, meId, idOpts) : groupExpense(ranged),
        },
      }
    }
    return {
      week: { HKD: sum(ws, we, 'HKD'), AUD: sum(ws, we, 'AUD') },
      month: { HKD: sum(ms, me, 'HKD'), AUD: sum(ms, me, 'AUD') },
    }
  }, [list, meId, defaultCurrency, idOpts])

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

  function resetFormFields(initial: MoneyType) {
    setType(initial)
    setCategory(initial === 'income' ? 'salary' : 'food')
    setSplitMode('personal')
    setPaidBy('me')
    setAmount('')
    setNote('')
    setDate(new Date().toISOString().slice(0, 10))
    setFormCurrency(readLastCurrency(defaultCurrency))
    setMyShareInput('')
    setPartnerShareInput('')
  }

  function openForm(initial: MoneyType) {
    setEditingId(null)
    setEditingCreatedAt(null)
    resetFormFields(initial)
    setShowForm(true)
  }

  function openEdit(entry: MoneyEntry) {
    setEditingId(entry.id)
    setEditingCreatedAt(entry.createdAt)
    setType(entry.type)
    setCategory(entry.category)
    setAmount(String(entry.amount))
    setNote(entry.note || '')
    setDate(entry.date)
    setFormCurrency(entryCurrency(entry, defaultCurrency))
    const mode = effectiveSplitMode(entry)
    setSplitMode(mode === 'custom' ? 'custom' : mode === 'equal' ? 'equal' : 'personal')
    const payerIsMe =
      !entry.paidById ||
      entry.paidById === meId ||
      idsEquivalent(entry.paidById, meId, aliasMap)
    setPaidBy(payerIsMe ? 'me' : 'partner')

    // If entry references a specific partner id, prefer that for the form
    if (entry.paidById && !payerIsMe) {
      setPreferredPartnerId(entry.paidById)
    } else if (entry.participantIds) {
      const other = entry.participantIds.find(
        (id) => id && !idsEquivalent(id, meId, aliasMap),
      )
      if (other) setPreferredPartnerId(other)
    }

    if (mode === 'custom' && entry.shares) {
      const mine =
        shareAmountFromMap(entry.shares, meId, aliasMap) ??
        (meId ? entry.shares[meId] : undefined)
      let theirs: number | undefined
      if (partnerId) {
        theirs =
          shareAmountFromMap(entry.shares, partnerId, aliasMap) ??
          entry.shares[partnerId]
      }
      if (theirs == null) {
        const otherEntry = Object.entries(entry.shares).find(
          ([id]) => !idsEquivalent(id, meId, aliasMap),
        )
        theirs = otherEntry ? Number(otherEntry[1]) : undefined
      }
      setMyShareInput(mine != null ? String(mine) : '')
      setPartnerShareInput(theirs != null ? String(theirs) : '')
    } else {
      setMyShareInput('')
      setPartnerShareInput('')
    }
    setShowForm(true)
  }

  function openSettleForm(preferCurrency?: EntryCurrency) {
    setSettleAmount('')
    setSettleCurrency(preferCurrency || readLastCurrency(defaultCurrency))
    setSettleFrom('me')
    setSettleDate(new Date().toISOString().slice(0, 10))
    setSettleNote('')
    setShowSettleForm(true)
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
    const pidPartner = partnerId || null
    if ((splitMode === 'equal' || splitMode === 'custom' || paidBy === 'partner') && !pidPartner) {
      alert(
        partnerResolution.ambiguous
          ? t('money.pickPartnerHint')
          : t('money.needPartnerMember'),
      )
      return
    }
    // Always write real auth uids of chosen members — never invent "partner"
    const paidById = payerIsMe ? settings.userId : (pidPartner as string)
    const paidByName = payerIsMe ? meName : (partnerMember?.displayName || partnerLabel)

    let mode: SplitMode = 'personal'
    if (type === 'expense') {
      if (splitMode === 'equal') mode = 'equal'
      else if (splitMode === 'custom') mode = 'custom'
      else mode = 'personal'
    }

    const participantIds =
      mode === 'equal' || mode === 'custom'
        ? [settings.userId, pidPartner as string]
        : [paidById]
    const participantNames =
      mode === 'equal' || mode === 'custom'
        ? [meName, partnerMember?.displayName || partnerLabel]
        : [paidByName]

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
        [pidPartner as string]: Math.round(theirs * 100) / 100,
      }
    }

    const entry: MoneyEntry = {
      id: editingId || uid(),
      type,
      amount: Math.round(n * 100) / 100,
      category,
      note: note.trim() || undefined,
      date,
      createdAt: editingCreatedAt || now,
      updatedAt: now,
      currency: formCurrency,
      paidById,
      paidByName,
      splitMode: mode,
      participantIds,
      participantNames,
      shares,
    }
    rememberCurrency(formCurrency)
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
    setEditingId(null)
    setEditingCreatedAt(null)
    setShowForm(false)
  }

  async function saveSettlement() {
    const n = Number(settleAmount)
    if (!Number.isFinite(n) || n <= 0 || !settings?.userId || !partnerId) {
      alert(
        partnerResolution.ambiguous
          ? t('money.pickPartnerHint')
          : t('money.needPartnerMember'),
      )
      return
    }
    const now = new Date().toISOString()
    const fromIsMe = settleFrom === 'me'
    const fromUserId = fromIsMe ? settings.userId : partnerId
    const toUserId = fromIsMe ? partnerId : settings.userId
    const fromUserName = fromIsMe ? meName : (partnerMember?.displayName || partnerLabel)
    const toUserName = fromIsMe ? (partnerMember?.displayName || partnerLabel) : meName
    const sDoc: Settlement = {
      id: uid(),
      amount: Math.round(n * 100) / 100,
      currency: settleCurrency,
      fromUserId,
      toUserId,
      fromUserName,
      toUserName,
      date: settleDate,
      note: settleNote.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    }
    rememberCurrency(settleCurrency)
    await db.settlements.put(sDoc)
    try {
      await pushSettlement(sDoc)
    } catch {
      alert(t('money.syncPushFailed'))
    }
    setShowSettleForm(false)
  }

  async function remove(entry: MoneyEntry) {
    if (!confirm(t('common.confirmDelete'))) return
    const next = { ...entry, deleted: true, updatedAt: new Date().toISOString() }
    await db.moneyEntries.put(next)
    await pushMoneyEntry(next)
  }

  async function removeSettlement(s: Settlement) {
    if (!confirm(t('common.confirmDelete'))) return
    const next = { ...s, deleted: true, updatedAt: new Date().toISOString() }
    await db.settlements.put(next)
    await pushSettlement(next)
  }

  function doExport() {
    downloadMoneyCsv(list, settleList, defaultCurrency)
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
    const payerIsMe =
      e.paidById != null && idsEquivalent(e.paidById, meId, aliasMap)
    const payer =
      e.paidByName ||
      (payerIsMe || (!e.paidById && meId) ? meName : partnerLabel)
    if (e.type === 'income') {
      return t('money.receivedBy', { name: payer })
    }
    if (mode === 'equal') {
      const myShare = meId ? shareForUser(e, meId, idOpts) : e.amount / 2
      return `${t('money.sharedEqual')} · ${t('money.paidBy')}: ${payer} · ${t('money.myShare')}: ${fmt(myShare, cur)}`
    }
    if (mode === 'custom') {
      const map = sharesForEntry(e, meId || 'me', partnerId, idOpts)
      const myAmt = meId
        ? (shareAmountFromMap(map, meId, aliasMap) ?? map[meId] ?? 0)
        : 0
      const partnerAmt = partnerId
        ? (shareAmountFromMap(map, partnerId, aliasMap) ?? map[partnerId] ?? 0)
        : Object.entries(map).find(([id]) => !idsEquivalent(id, meId, aliasMap))?.[1] ?? 0
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

  function PartnerPicker() {
    if (!partnerResolution.ambiguous && partnerResolution.candidates.length <= 1) {
      return null
    }
    if (partnerResolution.candidates.length === 0) return null
    return (
      <div className="field">
        <label>{t('money.pickPartner')}</label>
        <div className="muted" style={{ fontSize: '0.78rem', marginBottom: 4 }}>
          {t('money.pickPartnerHint')}
        </div>
        <div className="chip-row">
          {partnerResolution.candidates.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`chip${partnerId === m.id ? ' active' : ''}`}
              onClick={() => setPreferredPartnerId(m.id)}
            >
              {memberLabel(m, { showEmail: true })}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="card stack">
        <div className="row between">
          <h2 style={{ margin: 0 }}>{t('money.title')}</h2>
          <div className="row">
            <button type="button" className="btn secondary small" onClick={doExport}>
              {t('money.exportCsv')}
            </button>
            <button type="button" className="btn" onClick={() => openForm('expense')}>
              {t('money.add')}
            </button>
          </div>
        </div>
        <div className="muted" style={{ fontSize: '0.78rem' }}>
          {t('money.dualCurrencyHint')}
        </div>
        <div className="muted" style={{ fontSize: '0.78rem' }}>
          {t('money.sameEmailHint')}
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
        <div className="row between">
          <strong>{t('money.settlement')}</strong>
          <button
            type="button"
            className="btn small"
            disabled={!partnerId}
            onClick={() => openSettleForm()}
          >
            {t('money.recordPayment')}
          </button>
        </div>
        <div className="muted" style={{ fontSize: '0.78rem' }}>
          {t('money.settlementHint')}
        </div>
        <PartnerPicker />
        {CURRENCIES.map((c) => (
          <SettlementBlock key={c} currency={c} />
        ))}
        {!partnerId ? (
          <div className="muted" style={{ fontSize: '0.78rem' }}>
            {partnerResolution.ambiguous
              ? t('money.pickPartnerHint')
              : t('money.needPartnerMember')}
          </div>
        ) : null}

        {settleList.length > 0 ? (
          <div className="stack" style={{ marginTop: 8 }}>
            <div className="scope-heading">{t('money.settlementHistory')}</div>
            {settleList.map((s) => {
              const cur = entryCurrency(s, defaultCurrency)
              const fromIsMe = idsEquivalent(s.fromUserId, meId, aliasMap)
              const toIsMe = idsEquivalent(s.toUserId, meId, aliasMap)
              return (
                <div key={s.id} className="money-item">
                  <div>
                    <div>
                      <strong>
                        {s.fromUserName || (fromIsMe ? meName : partnerLabel)}
                        {' → '}
                        {s.toUserName || (toIsMe ? meName : partnerLabel)}
                      </strong>
                      <span className="tag currency-tag">{cur}</span>
                      <span className="tag shared">{t('money.settlement')}</span>
                    </div>
                    <div className="muted">
                      {s.date}
                      {s.note ? ` · ${s.note}` : ''}
                    </div>
                    <button
                      type="button"
                      className="btn danger small"
                      onClick={() => void removeSettlement(s)}
                    >
                      {t('todos.delete')}
                    </button>
                  </div>
                  <div className="amount income">{fmt(s.amount, cur)}</div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="muted" style={{ fontSize: '0.78rem' }}>
            {t('money.noSettlements')}
          </div>
        )}
      </div>

      {settings?.roomCode ? (
        <div className="card stack">
          <strong>{t('money.groupMembers')}</strong>
          <RoomMembersList members={memberList} meId={meId} showDuplicateHint />
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
                  <div className="row" style={{ gap: 6, marginTop: 4 }}>
                    <button
                      type="button"
                      className="btn secondary small"
                      onClick={() => openEdit(e)}
                    >
                      {t('money.edit')}
                    </button>
                    <button
                      type="button"
                      className="btn danger small"
                      onClick={() => void remove(e)}
                    >
                      {t('todos.delete')}
                    </button>
                  </div>
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
        <div
          className="modal-backdrop"
          onClick={() => {
            setShowForm(false)
            setEditingId(null)
            setEditingCreatedAt(null)
          }}
        >
          <div className="modal stack" onClick={(e) => e.stopPropagation()}>
            <h2>{editingId ? t('money.editEntry') : t('money.add')}</h2>
            <PartnerPicker />
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
                    disabled={!partnerId}
                  >
                    {t('money.sharedEqual')}
                  </button>
                  <button
                    type="button"
                    className={`chip${splitMode === 'custom' ? ' active' : ''}`}
                    onClick={() => setSplitAndInit('custom')}
                    disabled={!partnerId}
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
                  disabled={!partnerId}
                >
                  {t('money.partner')} ({partnerLabel})
                </button>
              </div>
              {!partnerId ? (
                <div className="muted" style={{ fontSize: '0.78rem', marginTop: 4 }}>
                  {partnerResolution.ambiguous
                    ? t('money.pickPartnerHint')
                    : t('money.needPartnerMember')}
                </div>
              ) : null}
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
              {recentCategories.length > 0 ? (
                <div className="chip-row" style={{ marginBottom: 6 }}>
                  <span className="muted" style={{ fontSize: '0.75rem' }}>
                    {t('money.recentCategories')}:
                  </span>
                  {recentCategories.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`chip${category === c ? ' active' : ''}`}
                      onClick={() => setCategory(c)}
                    >
                      {t(`money.categories.${c}`, c)}
                    </button>
                  ))}
                </div>
              ) : null}
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
              <button
                type="button"
                className="btn secondary grow"
                onClick={() => {
                  setShowForm(false)
                  setEditingId(null)
                  setEditingCreatedAt(null)
                }}
              >
                {t('todos.cancel')}
              </button>
              <button type="button" className="btn grow" onClick={() => void save()}>
                {t('todos.save')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showSettleForm ? (
        <div className="modal-backdrop" onClick={() => setShowSettleForm(false)}>
          <div className="modal stack" onClick={(e) => e.stopPropagation()}>
            <h2>{t('money.recordPaymentTitle')}</h2>
            <PartnerPicker />
            <div className="field">
              <label>{t('money.entryCurrency')}</label>
              <div className="chip-row">
                {CURRENCIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`chip${settleCurrency === c ? ' active' : ''}`}
                    onClick={() => setSettleCurrency(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>{t('money.paymentFrom')}</label>
              <div className="chip-row">
                <button
                  type="button"
                  className={`chip${settleFrom === 'me' ? ' active' : ''}`}
                  onClick={() => setSettleFrom('me')}
                >
                  {t('money.me')} ({meName})
                </button>
                <button
                  type="button"
                  className={`chip${settleFrom === 'partner' ? ' active' : ''}`}
                  onClick={() => setSettleFrom('partner')}
                  disabled={!partnerId}
                >
                  {t('money.partner')} ({partnerLabel})
                </button>
              </div>
            </div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>
              {t('money.paymentTo')}:{' '}
              <strong>{settleFrom === 'me' ? partnerLabel : meName}</strong>
            </div>
            <div className="field">
              <label>{t('money.amount')}</label>
              <input
                inputMode="decimal"
                value={settleAmount}
                onChange={(e) => setSettleAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="field">
              <label>{t('money.date')}</label>
              <input
                type="date"
                value={settleDate}
                onChange={(e) => setSettleDate(e.target.value)}
              />
            </div>
            <div className="field">
              <label>{t('money.note')}</label>
              <input
                value={settleNote}
                onChange={(e) => setSettleNote(e.target.value)}
                placeholder={t('money.settlementNote')}
              />
            </div>
            <div className="row">
              <button
                type="button"
                className="btn secondary grow"
                onClick={() => setShowSettleForm(false)}
              >
                {t('todos.cancel')}
              </button>
              <button type="button" className="btn grow" onClick={() => void saveSettlement()}>
                {t('todos.save')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
