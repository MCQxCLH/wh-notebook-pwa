import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { db } from '../db/database'
import type { Todo } from '../db/types'
import { uid } from '../utils/id'
import { pushReminder, pushTodo } from '../sync/syncService'

export function TodosPage() {
  const { t } = useTranslation()
  const todos = useLiveQuery(
    () => db.todos.filter((x) => !x.deleted).sortBy('order'),
    [],
  )
  const reminders = useLiveQuery(
    () =>
      db.reminders
        .filter((x) => !x.deleted && !x.fired)
        .toArray()
        .then((arr) => arr.sort((a, b) => a.at.localeCompare(b.at))),
    [],
  )
  const [draft, setDraft] = useState('')
  const [standTitle, setStandTitle] = useState('')
  const [standAt, setStandAt] = useState('')
  const [editing, setEditing] = useState<Todo | null>(null)
  const [reminderTodo, setReminderTodo] = useState<Todo | null>(null)
  const [reminderAt, setReminderAt] = useState('')

  const list = todos ?? []
  const active = useMemo(() => list.filter((x) => !x.completed), [list])
  const done = useMemo(() => list.filter((x) => x.completed), [list])

  async function addTodo() {
    const title = draft.trim()
    if (!title) return
    const maxOrder = list.reduce((m, x) => Math.max(m, x.order), 0)
    const now = new Date().toISOString()
    const todo: Todo = {
      id: uid(),
      title,
      completed: false,
      order: maxOrder + 1,
      createdAt: now,
      updatedAt: now,
    }
    await db.todos.put(todo)
    await pushTodo(todo)
    setDraft('')
  }

  async function toggle(todo: Todo) {
    const next = {
      ...todo,
      completed: !todo.completed,
      updatedAt: new Date().toISOString(),
    }
    await db.todos.put(next)
    await pushTodo(next)
  }

  async function remove(todo: Todo) {
    if (!confirm(t('common.confirmDelete'))) return
    const next = { ...todo, deleted: true, updatedAt: new Date().toISOString() }
    await db.todos.put(next)
    await pushTodo(next)
  }

  async function saveEdit() {
    if (!editing) return
    const next = {
      ...editing,
      title: editing.title.trim(),
      notes: editing.notes?.trim() ? editing.notes.trim() : undefined,
      updatedAt: new Date().toISOString(),
    }
    if (!next.title) return
    await db.todos.put(next)
    await pushTodo(next)
    setEditing(null)
  }

  async function move(todo: Todo, dir: -1 | 1) {
    const idx = list.findIndex((x) => x.id === todo.id)
    const swapIdx = idx + dir
    if (idx < 0 || swapIdx < 0 || swapIdx >= list.length) return
    const other = list[swapIdx]!
    const a = { ...todo, order: other.order, updatedAt: new Date().toISOString() }
    const b = { ...other, order: todo.order, updatedAt: new Date().toISOString() }
    await db.todos.bulkPut([a, b])
    await pushTodo(a)
    await pushTodo(b)
  }

  async function saveReminder() {
    if (!reminderTodo || !reminderAt) return
    const now = new Date().toISOString()
    const at = new Date(reminderAt).toISOString()
    const reminder = {
      id: uid(),
      title: reminderTodo.title,
      body: reminderTodo.notes || '',
      at,
      todoId: reminderTodo.id,
      fired: false,
      createdAt: now,
      updatedAt: now,
    }
    const nextTodo = {
      ...reminderTodo,
      reminderAt: at,
      updatedAt: now,
    }
    await db.reminders.put(reminder)
    await db.todos.put(nextTodo)
    await pushReminder(reminder)
    await pushTodo(nextTodo)
    setReminderTodo(null)
    setReminderAt('')
  }

  async function addStandaloneReminder() {
    const title = standTitle.trim()
    if (!title || !standAt) return
    const now = new Date().toISOString()
    const reminder = {
      id: uid(),
      title,
      at: new Date(standAt).toISOString(),
      todoId: null,
      fired: false,
      createdAt: now,
      updatedAt: now,
    }
    await db.reminders.put(reminder)
    await pushReminder(reminder)
    setStandTitle('')
    setStandAt('')
  }

  function renderItem(todo: Todo) {
    return (
      <div key={todo.id} className={`todo-item${todo.completed ? ' done' : ''}`}>
        <button
          type="button"
          className={`check${todo.completed ? ' on' : ''}`}
          onClick={() => void toggle(todo)}
          aria-label="toggle"
        >
          {todo.completed ? '✓' : ''}
        </button>
        <div className="grow">
          <button
            type="button"
            className="todo-title-btn"
            onClick={() => setEditing(todo)}
            title={t('todos.tapToEdit')}
          >
            <div className="todo-title">{todo.title}</div>
            {todo.notes ? <div className="muted">{todo.notes}</div> : null}
          </button>
          {todo.reminderAt ? (
            <div className="muted">
              ⏰ {new Date(todo.reminderAt).toLocaleString()}
            </div>
          ) : null}
          <div className="actions">
            <button
              type="button"
              className="btn secondary small"
              onClick={() => setEditing(todo)}
            >
              {t('todos.edit')}
            </button>
            <button
              type="button"
              className="btn ghost small"
              onClick={() => {
                setReminderTodo(todo)
                setReminderAt(
                  todo.reminderAt
                    ? todo.reminderAt.slice(0, 16)
                    : new Date(Date.now() + 3600000).toISOString().slice(0, 16),
                )
              }}
            >
              {t('todos.setReminder')}
            </button>
            <button type="button" className="btn ghost small" onClick={() => void move(todo, -1)}>
              ↑
            </button>
            <button type="button" className="btn ghost small" onClick={() => void move(todo, 1)}>
              ↓
            </button>
            <button type="button" className="btn danger small" onClick={() => void remove(todo)}>
              {t('todos.delete')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>{t('todos.title')}</h2>
        <div className="row">
          <input
            className="grow"
            style={{
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: '10px 12px',
            }}
            placeholder={t('todos.placeholder')}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addTodo()
            }}
          />
          <button type="button" className="btn" onClick={() => void addTodo()}>
            {t('todos.add')}
          </button>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          {t('reminders.limitation')}
        </p>
      </div>

      <div className="card stack">
        <strong>{t('reminders.title')}</strong>
        <div className="field">
          <label>{t('reminders.standalone')}</label>
          <input
            value={standTitle}
            onChange={(e) => setStandTitle(e.target.value)}
            placeholder={t('todos.placeholder')}
          />
        </div>
        <div className="field">
          <label>{t('reminders.at')}</label>
          <input
            type="datetime-local"
            value={standAt}
            onChange={(e) => setStandAt(e.target.value)}
          />
        </div>
        <button type="button" className="btn secondary" onClick={() => void addStandaloneReminder()}>
          {t('reminders.add')}
        </button>
        <div className="muted">{t('reminders.upcoming')}</div>
        {(reminders ?? []).length === 0 ? (
          <div className="muted">—</div>
        ) : (
          (reminders ?? []).map((r) => (
            <div key={r.id} className="row between">
              <div>
                <div>{r.title}</div>
                <div className="muted">{new Date(r.at).toLocaleString()}</div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <div className="muted" style={{ marginBottom: 8 }}>
          {t('todos.active')} ({active.length})
        </div>
        {active.length === 0 ? <div className="empty">{t('todos.empty')}</div> : active.map(renderItem)}
        {active.length > 0 ? (
          <div className="muted" style={{ fontSize: '0.78rem', marginTop: 8 }}>
            {t('todos.editHint')}
          </div>
        ) : null}
      </div>

      {done.length > 0 ? (
        <div className="card">
          <div className="muted" style={{ marginBottom: 8 }}>
            {t('todos.completed')} ({done.length})
          </div>
          {done.map(renderItem)}
        </div>
      ) : null}

      {editing ? (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div className="modal stack" onClick={(e) => e.stopPropagation()}>
            <h2>{t('todos.edit')}</h2>
            <div className="field">
              <label>{t('todos.placeholder')}</label>
              <input
                value={editing.title}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                autoFocus
              />
            </div>
            <div className="field">
              <label>{t('todos.notes')}</label>
              <textarea
                value={editing.notes || ''}
                onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                placeholder={t('todos.notesPlaceholder')}
              />
            </div>
            <div className="row">
              <button type="button" className="btn secondary grow" onClick={() => setEditing(null)}>
                {t('todos.cancel')}
              </button>
              <button type="button" className="btn grow" onClick={() => void saveEdit()}>
                {t('todos.save')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {reminderTodo ? (
        <div className="modal-backdrop" onClick={() => setReminderTodo(null)}>
          <div className="modal stack" onClick={(e) => e.stopPropagation()}>
            <h2>{t('todos.setReminder')}</h2>
            <div className="field">
              <label>{t('reminders.at')}</label>
              <input
                type="datetime-local"
                value={reminderAt}
                onChange={(e) => setReminderAt(e.target.value)}
              />
            </div>
            <div className="row">
              <button
                type="button"
                className="btn secondary grow"
                onClick={() => setReminderTodo(null)}
              >
                {t('todos.cancel')}
              </button>
              <button type="button" className="btn grow" onClick={() => void saveReminder()}>
                {t('todos.save')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
