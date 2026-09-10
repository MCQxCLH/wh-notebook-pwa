import Dexie, { type EntityTable } from 'dexie'
import type {
  Todo,
  Reminder,
  JournalEntry,
  JournalComment,
  MoneyEntry,
  AppSettings,
  RoomMember,
} from './types'
import { uid } from '../utils/id'

const defaultSettings = (): AppSettings => ({
  id: 'settings',
  language: 'zh-Hant',
  currency: 'HKD',
  whStart: new Date().toISOString().slice(0, 10),
  whEnd: new Date(Date.now() + 1000 * 60 * 60 * 24 * 180).toISOString().slice(0, 10),
  displayName: 'Traveler',
  partnerName: '',
  roomCode: null,
  userId: null,
  notificationPermissionAsked: false,
  updatedAt: new Date().toISOString(),
})

class WhNotebookDB extends Dexie {
  todos!: EntityTable<Todo, 'id'>
  reminders!: EntityTable<Reminder, 'id'>
  journalEntries!: EntityTable<JournalEntry, 'id'>
  journalComments!: EntityTable<JournalComment, 'id'>
  moneyEntries!: EntityTable<MoneyEntry, 'id'>
  roomMembers!: EntityTable<RoomMember, 'id'>
  settings!: EntityTable<AppSettings, 'id'>

  constructor() {
    super('wh-notebook')
    this.version(1).stores({
      todos: 'id, order, completed, updatedAt',
      reminders: 'id, at, fired, todoId, updatedAt',
      journalEntries: 'id, date, updatedAt',
      journalComments: 'id, entryId, createdAt, updatedAt',
      moneyEntries: 'id, date, type, updatedAt',
      settings: 'id',
    })
    this.version(2).stores({
      todos: 'id, order, completed, updatedAt',
      reminders: 'id, at, fired, todoId, updatedAt',
      journalEntries: 'id, date, updatedAt',
      journalComments: 'id, entryId, createdAt, updatedAt',
      moneyEntries: 'id, date, type, updatedAt',
      roomMembers: 'id, updatedAt',
      settings: 'id',
    })
  }
}

export const db = new WhNotebookDB()

export async function ensureSettings(): Promise<AppSettings> {
  const existing = await db.settings.get('settings')
  if (existing) {
    let changed = false
    const next: AppSettings = {
      ...defaultSettings(),
      ...existing,
      partnerName: existing.partnerName ?? '',
      userId: existing.userId,
    }
    if (!next.userId) {
      next.userId = uid()
      changed = true
    }
    if (existing.partnerName === undefined) {
      next.partnerName = ''
      changed = true
    }
    if (changed) {
      next.updatedAt = new Date().toISOString()
      await db.settings.put(next)
      return next
    }
    return {
      ...existing,
      partnerName: existing.partnerName ?? '',
      userId: existing.userId,
    } as AppSettings
  }
  const s = defaultSettings()
  s.userId = uid()
  await db.settings.put(s)
  return s
}

export { defaultSettings }
