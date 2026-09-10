import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { db, ensureSettings } from '../db/database'
import type { JournalEntry } from '../db/types'
import { uid } from '../utils/id'
import { pushJournalComment, pushJournalEntry } from '../sync/syncService'

export function JournalPage() {
  const { t } = useTranslation()
  const entries = useLiveQuery(
    () =>
      db.journalEntries
        .filter((x) => !x.deleted)
        .toArray()
        .then((arr) => arr.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))),
    [],
  )
  const comments = useLiveQuery(
    () => db.journalComments.filter((x) => !x.deleted).toArray(),
    [],
  )
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState<string | null>(null)

  const byEntry = useMemo(() => {
    const map = new Map<string, typeof comments>()
    for (const c of comments ?? []) {
      const list = map.get(c.entryId) || []
      list.push(c)
      map.set(c.entryId, list)
    }
    for (const [k, list] of map) {
      map.set(
        k,
        [...(list || [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      )
    }
    return map
  }, [comments])

  async function addEntry() {
    if (!title.trim() && !body.trim()) return
    const now = new Date().toISOString()
    const entry: JournalEntry = {
      id: uid(),
      date,
      title: title.trim() || date,
      body: body.trim(),
      createdAt: now,
      updatedAt: now,
    }
    await db.journalEntries.put(entry)
    await pushJournalEntry(entry)
    setTitle('')
    setBody('')
    setShowForm(false)
  }

  async function removeEntry(entry: JournalEntry) {
    if (!confirm(t('common.confirmDelete'))) return
    const next = { ...entry, deleted: true, updatedAt: new Date().toISOString() }
    await db.journalEntries.put(next)
    await pushJournalEntry(next)
  }

  async function addComment(entryId: string) {
    const text = (commentDrafts[entryId] || '').trim()
    if (!text) return
    const settings = await ensureSettings()
    const now = new Date().toISOString()
    const comment = {
      id: uid(),
      entryId,
      author: settings.displayName || 'Traveler',
      body: text,
      createdAt: now,
      updatedAt: now,
    }
    await db.journalComments.put(comment)
    await pushJournalComment(comment)
    setCommentDrafts((d) => ({ ...d, [entryId]: '' }))
  }

  return (
    <>
      <div className="card row between">
        <h2 style={{ margin: 0 }}>{t('journal.title')}</h2>
        <button type="button" className="btn" onClick={() => setShowForm(true)}>
          {t('journal.add')}
        </button>
      </div>

      {(entries ?? []).length === 0 ? (
        <div className="card empty">{t('journal.empty')}</div>
      ) : (
        (entries ?? []).map((entry) => {
          const thread = byEntry.get(entry.id) || []
          const open = expanded === entry.id
          return (
            <div key={entry.id} className="card stack">
              <div className="row between">
                <div>
                  <div className="muted">{entry.date}</div>
                  <strong>{entry.title}</strong>
                </div>
                <button
                  type="button"
                  className="btn danger small"
                  onClick={() => void removeEntry(entry)}
                >
                  {t('todos.delete')}
                </button>
              </div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{entry.body}</div>
              <button
                type="button"
                className="btn ghost small"
                onClick={() => setExpanded(open ? null : entry.id)}
              >
                {t('journal.comments')} ({thread.length})
              </button>
              {open ? (
                <div className="stack">
                  {thread.map((c) => (
                    <div key={c.id} className="comment">
                      <div className="meta">
                        {c.author} · {new Date(c.createdAt).toLocaleString()}
                      </div>
                      <div>{c.body}</div>
                    </div>
                  ))}
                  <div className="row">
                    <input
                      className="grow"
                      style={{
                        border: '1px solid var(--border)',
                        borderRadius: 12,
                        padding: '10px 12px',
                      }}
                      placeholder={t('journal.commentPlaceholder')}
                      value={commentDrafts[entry.id] || ''}
                      onChange={(e) =>
                        setCommentDrafts((d) => ({ ...d, [entry.id]: e.target.value }))
                      }
                    />
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => void addComment(entry.id)}
                    >
                      {t('journal.addComment')}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )
        })
      )}

      {showForm ? (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <div className="modal stack" onClick={(e) => e.stopPropagation()}>
            <h2>{t('journal.add')}</h2>
            <div className="field">
              <label>{t('journal.date')}</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="field">
              <label>{t('journal.entryTitle')}</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="field">
              <label>{t('journal.body')}</label>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} />
            </div>
            <div className="row">
              <button type="button" className="btn secondary grow" onClick={() => setShowForm(false)}>
                {t('todos.cancel')}
              </button>
              <button type="button" className="btn grow" onClick={() => void addEntry()}>
                {t('todos.save')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
