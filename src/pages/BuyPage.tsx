import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { db, ensureSettings } from '../db/database'
import type { BuyCategory, BuyItem } from '../db/types'
import { uid } from '../utils/id'
import { pushBuyItem } from '../sync/syncService'

type Filter = 'all' | BuyCategory

const emptyForm = () => ({
  name: '',
  category: 'groceries' as BuyCategory,
  budget: '',
  remarks: '',
})

export function BuyPage() {
  const { t } = useTranslation()
  const settings = useLiveQuery(() => ensureSettings(), [])
  const items = useLiveQuery(
    () =>
      db.buyItems
        .filter((x) => !x.deleted)
        .toArray()
        .then((arr) =>
          arr.sort((a, b) => {
            if (a.bought !== b.bought) return a.bought ? 1 : -1
            return b.updatedAt.localeCompare(a.updatedAt)
          }),
        ),
    [],
  )

  const [filter, setFilter] = useState<Filter>('all')
  const [form, setForm] = useState(emptyForm)
  const [editing, setEditing] = useState<BuyItem | null>(null)
  const [editForm, setEditForm] = useState(emptyForm)

  const list = items ?? []
  const currencyLabel = settings?.currency || 'HKD'

  const filtered = useMemo(() => {
    if (filter === 'all') return list
    return list.filter((x) => x.category === filter)
  }, [list, filter])

  const groceries = useMemo(
    () => filtered.filter((x) => x.category === 'groceries'),
    [filtered],
  )
  const nonGroceries = useMemo(
    () => filtered.filter((x) => x.category === 'nonGroceries'),
    [filtered],
  )

  function parseBudget(raw: string): number | undefined {
    const trimmed = raw.trim()
    if (!trimmed) return undefined
    const n = Number(trimmed)
    if (!Number.isFinite(n) || n < 0) return undefined
    return n
  }

  async function addItem() {
    const name = form.name.trim()
    if (!name) return
    const now = new Date().toISOString()
    const budget = parseBudget(form.budget)
    const item: BuyItem = {
      id: uid(),
      name,
      category: form.category,
      bought: false,
      createdAt: now,
      updatedAt: now,
      ...(budget !== undefined ? { budget } : {}),
      ...(form.remarks.trim() ? { remarks: form.remarks.trim() } : {}),
    }
    await db.buyItems.put(item)
    await pushBuyItem(item)
    setForm(emptyForm())
  }

  async function toggleBought(item: BuyItem) {
    const next: BuyItem = {
      ...item,
      bought: !item.bought,
      updatedAt: new Date().toISOString(),
    }
    await db.buyItems.put(next)
    await pushBuyItem(next)
  }

  async function remove(item: BuyItem) {
    if (!confirm(t('common.confirmDelete'))) return
    const next: BuyItem = {
      ...item,
      deleted: true,
      updatedAt: new Date().toISOString(),
    }
    await db.buyItems.put(next)
    await pushBuyItem(next)
  }

  function openEdit(item: BuyItem) {
    setEditing(item)
    setEditForm({
      name: item.name,
      category: item.category,
      budget: item.budget !== undefined ? String(item.budget) : '',
      remarks: item.remarks || '',
    })
  }

  async function saveEdit() {
    if (!editing) return
    const name = editForm.name.trim()
    if (!name) return
    const budget = parseBudget(editForm.budget)
    const next: BuyItem = {
      ...editing,
      name,
      category: editForm.category,
      updatedAt: new Date().toISOString(),
    }
    if (budget !== undefined) next.budget = budget
    else delete next.budget
    if (editForm.remarks.trim()) next.remarks = editForm.remarks.trim()
    else delete next.remarks
    await db.buyItems.put(next)
    await pushBuyItem(next)
    setEditing(null)
  }

  function formatBudget(n: number) {
    return `${currencyLabel} ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  }

  function renderSection(title: string, sectionItems: BuyItem[]) {
    if (filter !== 'all' && sectionItems.length === 0 && list.length > 0) {
      return null
    }
    return (
      <div className="card" key={title}>
        <div className="muted" style={{ marginBottom: 8 }}>
          {title} ({sectionItems.length})
        </div>
        {sectionItems.length === 0 ? (
          <div className="empty">{t('buy.emptyCategory')}</div>
        ) : (
          sectionItems.map((item) => (
            <div
              key={item.id}
              className={`todo-item${item.bought ? ' done' : ''}`}
              style={{ marginBottom: 8 }}
            >
              <button
                type="button"
                className={`check${item.bought ? ' on' : ''}`}
                onClick={() => void toggleBought(item)}
                aria-label="toggle bought"
              >
                {item.bought ? '✓' : ''}
              </button>
              <div className="grow">
                <button
                  type="button"
                  className="todo-title-btn"
                  onClick={() => openEdit(item)}
                >
                  <div className="todo-title">{item.name}</div>
                  {item.budget !== undefined ? (
                    <div className="muted">{formatBudget(item.budget)}</div>
                  ) : null}
                  {item.remarks ? <div className="muted">{item.remarks}</div> : null}
                </button>
                <div className="actions">
                  <button
                    type="button"
                    className="btn secondary small"
                    onClick={() => openEdit(item)}
                  >
                    {t('buy.edit')}
                  </button>
                  <button
                    type="button"
                    className="btn danger small"
                    onClick={() => void remove(item)}
                  >
                    {t('buy.delete')}
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    )
  }

  return (
    <>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>{t('buy.title')}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {t('buy.hint')}
        </p>
        <div className="chip-row">
          {(
            [
              ['all', t('buy.filterAll')],
              ['groceries', t('buy.groceries')],
              ['nonGroceries', t('buy.nonGroceries')],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`chip${filter === id ? ' active' : ''}`}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="card stack">
        <strong>{t('buy.add')}</strong>
        <div className="field">
          <label>{t('buy.name')} *</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={t('buy.namePlaceholder')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addItem()
            }}
          />
        </div>
        <div className="field">
          <label>{t('buy.category')}</label>
          <div className="chip-row">
            <button
              type="button"
              className={`chip${form.category === 'groceries' ? ' active' : ''}`}
              onClick={() => setForm({ ...form, category: 'groceries' })}
            >
              {t('buy.groceries')}
            </button>
            <button
              type="button"
              className={`chip${form.category === 'nonGroceries' ? ' active' : ''}`}
              onClick={() => setForm({ ...form, category: 'nonGroceries' })}
            >
              {t('buy.nonGroceries')}
            </button>
          </div>
        </div>
        <div className="field">
          <label>
            {t('buy.budget')}{' '}
            <span className="muted">({currencyLabel} · {t('buy.optional')})</span>
          </label>
          <input
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            value={form.budget}
            onChange={(e) => setForm({ ...form, budget: e.target.value })}
            placeholder="0"
          />
        </div>
        <div className="field">
          <label>
            {t('buy.remarks')} <span className="muted">({t('buy.optional')})</span>
          </label>
          <textarea
            value={form.remarks}
            onChange={(e) => setForm({ ...form, remarks: e.target.value })}
            placeholder={t('buy.remarksPlaceholder')}
          />
        </div>
        <button type="button" className="btn" onClick={() => void addItem()}>
          {t('buy.add')}
        </button>
      </div>

      {list.length === 0 ? (
        <div className="card empty">{t('buy.empty')}</div>
      ) : (
        <>
          {filter === 'all' || filter === 'groceries'
            ? renderSection(t('buy.groceries'), groceries)
            : null}
          {filter === 'all' || filter === 'nonGroceries'
            ? renderSection(t('buy.nonGroceries'), nonGroceries)
            : null}
        </>
      )}

      {editing ? (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div className="modal stack" onClick={(e) => e.stopPropagation()}>
            <h2>{t('buy.edit')}</h2>
            <div className="field">
              <label>{t('buy.name')} *</label>
              <input
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                autoFocus
              />
            </div>
            <div className="field">
              <label>{t('buy.category')}</label>
              <div className="chip-row">
                <button
                  type="button"
                  className={`chip${editForm.category === 'groceries' ? ' active' : ''}`}
                  onClick={() => setEditForm({ ...editForm, category: 'groceries' })}
                >
                  {t('buy.groceries')}
                </button>
                <button
                  type="button"
                  className={`chip${editForm.category === 'nonGroceries' ? ' active' : ''}`}
                  onClick={() =>
                    setEditForm({ ...editForm, category: 'nonGroceries' })
                  }
                >
                  {t('buy.nonGroceries')}
                </button>
              </div>
            </div>
            <div className="field">
              <label>
                {t('buy.budget')}{' '}
                <span className="muted">({currencyLabel} · {t('buy.optional')})</span>
              </label>
              <input
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={editForm.budget}
                onChange={(e) => setEditForm({ ...editForm, budget: e.target.value })}
              />
            </div>
            <div className="field">
              <label>
                {t('buy.remarks')} <span className="muted">({t('buy.optional')})</span>
              </label>
              <textarea
                value={editForm.remarks}
                onChange={(e) => setEditForm({ ...editForm, remarks: e.target.value })}
              />
            </div>
            <div className="row">
              <button
                type="button"
                className="btn secondary grow"
                onClick={() => setEditing(null)}
              >
                {t('buy.cancel')}
              </button>
              <button type="button" className="btn grow" onClick={() => void saveEdit()}>
                {t('buy.save')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
