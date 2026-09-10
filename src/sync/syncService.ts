import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore'
import { db, ensureSettings } from '../db/database'
import type {
  Todo,
  Reminder,
  JournalEntry,
  JournalComment,
  MoneyEntry,
  AppSettings,
  RoomMember,
} from '../db/types'
import { ensureAnonymousAuth, getFirebase, isFirebaseConfigured } from './firebase'

type SyncStatus = 'local' | 'connecting' | 'synced' | 'error'

let unsubs: Unsubscribe[] = []
let status: SyncStatus = 'local'
const statusListeners = new Set<(s: SyncStatus) => void>()

export function getSyncStatus(): SyncStatus {
  return status
}

export function onSyncStatus(cb: (s: SyncStatus) => void): () => void {
  statusListeners.add(cb)
  cb(status)
  return () => {
    statusListeners.delete(cb)
  }
}

function setStatus(s: SyncStatus) {
  status = s
  statusListeners.forEach((cb) => cb(s))
}

async function pushDoc(
  roomCode: string,
  col: string,
  id: string,
  data: Record<string, unknown>,
) {
  const fb = getFirebase()
  if (!fb) return
  await setDoc(doc(fb.db, 'rooms', roomCode, col, id), data, { merge: true })
}

export async function pushTodo(todo: Todo) {
  const s = await ensureSettings()
  if (!s.roomCode || !isFirebaseConfigured()) return
  await pushDoc(s.roomCode, 'todos', todo.id, { ...todo })
}

export async function pushReminder(r: Reminder) {
  const s = await ensureSettings()
  if (!s.roomCode || !isFirebaseConfigured()) return
  await pushDoc(s.roomCode, 'reminders', r.id, { ...r })
}

export async function pushJournalEntry(e: JournalEntry) {
  const s = await ensureSettings()
  if (!s.roomCode || !isFirebaseConfigured()) return
  await pushDoc(s.roomCode, 'journalEntries', e.id, { ...e })
}

export async function pushJournalComment(c: JournalComment) {
  const s = await ensureSettings()
  if (!s.roomCode || !isFirebaseConfigured()) return
  await pushDoc(s.roomCode, 'journalComments', c.id, { ...c })
}

export async function pushMoneyEntry(m: MoneyEntry) {
  const s = await ensureSettings()
  if (!s.roomCode || !isFirebaseConfigured()) return
  await pushDoc(s.roomCode, 'moneyEntries', m.id, { ...m })
}

export async function pushRoomMember(m: RoomMember) {
  const s = await ensureSettings()
  if (!s.roomCode || !isFirebaseConfigured()) return
  await pushDoc(s.roomCode, 'members', m.id, { ...m })
}

/** Upsert current user into local roomMembers and push to Firestore. */
export async function upsertSelfRoomMember(): Promise<RoomMember | null> {
  const s = await ensureSettings()
  if (!s.userId) return null
  const member: RoomMember = {
    id: s.userId,
    displayName: s.displayName || 'Traveler',
    updatedAt: new Date().toISOString(),
  }
  await db.roomMembers.put(member)
  await pushRoomMember(member)
  return member
}

export async function pushSettingsPartial(partial: Partial<AppSettings>) {
  const s = await ensureSettings()
  if (!s.roomCode || !isFirebaseConfigured()) return
  const shared = {
    language: partial.language ?? s.language,
    currency: partial.currency ?? s.currency,
    whStart: partial.whStart ?? s.whStart,
    whEnd: partial.whEnd ?? s.whEnd,
    updatedAt: new Date().toISOString(),
  }
  await pushDoc(s.roomCode, 'meta', 'settings', shared)
}

function pickNewer<T extends { updatedAt: string }>(local: T | undefined, remote: T): T {
  if (!local) return remote
  return remote.updatedAt >= local.updatedAt ? remote : local
}

async function mergeCollection<T extends { id: string; updatedAt: string }>(
  get: (id: string) => Promise<T | undefined>,
  put: (item: T) => Promise<unknown>,
  remote: T,
) {
  const local = await get(remote.id)
  await put(pickNewer(local, remote))
}

export async function startSync(): Promise<void> {
  stopSync()
  if (!isFirebaseConfigured()) {
    setStatus('local')
    return
  }
  const settings = await ensureSettings()
  if (!settings.roomCode) {
    setStatus('local')
    return
  }

  setStatus('connecting')
  try {
    await ensureAnonymousAuth()
    const fb = getFirebase()
    if (!fb) {
      setStatus('local')
      return
    }

    const roomCode = settings.roomCode
    const cols: Array<{
      name: string
      apply: (data: Record<string, unknown>) => Promise<void>
    }> = [
      {
        name: 'todos',
        apply: async (data) => {
          await mergeCollection((id) => db.todos.get(id), (item) => db.todos.put(item), data as unknown as Todo)
        },
      },
      {
        name: 'reminders',
        apply: async (data) => {
          await mergeCollection((id) => db.reminders.get(id), (item) => db.reminders.put(item), data as unknown as Reminder)
        },
      },
      {
        name: 'journalEntries',
        apply: async (data) => {
          await mergeCollection((id) => db.journalEntries.get(id), (item) => db.journalEntries.put(item), data as unknown as JournalEntry)
        },
      },
      {
        name: 'journalComments',
        apply: async (data) => {
          await mergeCollection((id) => db.journalComments.get(id), (item) => db.journalComments.put(item), data as unknown as JournalComment)
        },
      },
      {
        name: 'moneyEntries',
        apply: async (data) => {
          await mergeCollection((id) => db.moneyEntries.get(id), (item) => db.moneyEntries.put(item), data as unknown as MoneyEntry)
        },
      },
      {
        name: 'members',
        apply: async (data) => {
          await mergeCollection(
            (id) => db.roomMembers.get(id),
            (item) => db.roomMembers.put(item),
            data as unknown as RoomMember,
          )
        },
      },
    ]

    for (const col of cols) {
      const unsub = onSnapshot(
        collection(fb.db, 'rooms', roomCode, col.name),
        async (snap) => {
          for (const d of snap.docChanges()) {
            if (d.type === 'removed') continue
            await col.apply({ id: d.doc.id, ...d.doc.data() })
          }
          setStatus('synced')
        },
        () => setStatus('error'),
      )
      unsubs.push(unsub)
    }

    const metaUnsub = onSnapshot(
      doc(fb.db, 'rooms', roomCode, 'meta', 'settings'),
      async (snap) => {
        if (!snap.exists()) return
        const remote = snap.data() as Partial<AppSettings>
        const local = await ensureSettings()
        if ((remote.updatedAt || '') >= local.updatedAt) {
          await db.settings.put({
            ...local,
            language: (remote.language as AppSettings['language']) || local.language,
            currency: remote.currency || local.currency,
            whStart: remote.whStart || local.whStart,
            whEnd: remote.whEnd || local.whEnd,
            updatedAt: remote.updatedAt || local.updatedAt,
          })
        }
        setStatus('synced')
      },
      () => setStatus('error'),
    )
    unsubs.push(metaUnsub)

    await setDoc(
      doc(fb.db, 'rooms', roomCode),
      { code: roomCode, updatedAt: new Date().toISOString() },
      { merge: true },
    )

    await upsertSelfRoomMember()

    setStatus('synced')
  } catch {
    setStatus('error')
  }
}

export function stopSync() {
  unsubs.forEach((u) => u())
  unsubs = []
}

export async function pushAllLocal(): Promise<void> {
  const s = await ensureSettings()
  if (!s.roomCode || !isFirebaseConfigured()) return
  const [todos, reminders, entries, comments, money, members] = await Promise.all([
    db.todos.toArray(),
    db.reminders.toArray(),
    db.journalEntries.toArray(),
    db.journalComments.toArray(),
    db.moneyEntries.toArray(),
    db.roomMembers.toArray(),
  ])
  await Promise.all([
    ...todos.map((t) => pushTodo(t)),
    ...reminders.map((r) => pushReminder(r)),
    ...entries.map((e) => pushJournalEntry(e)),
    ...comments.map((c) => pushJournalComment(c)),
    ...money.map((m) => pushMoneyEntry(m)),
    ...members.map((m) => pushRoomMember(m)),
    pushSettingsPartial(s),
  ])
  await upsertSelfRoomMember()
}
