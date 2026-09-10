import Dexie, { type EntityTable } from 'dexie'
import type {
  Todo,
  Reminder,
  JournalEntry,
  JournalComment,
  MoneyEntry,
  AppSettings,
} from './types'

const defaultSettings = (): AppSettings => ({
  id: 'settings',
  language: 'zh-Hant',
  currency: 'HKD',
  whStart: new Date().toISOString().slice(0, 10),
  whEnd: new Date(Date.now() + 1000 * 60 * 60 * 24 * 180).toISOString().slice(0, 10),
  displayName: 'Traveler',
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
  }
}

export const db = new WhNotebookDB()

export async function ensureSettings(): Promise<AppSettings> {
  const existing = await db.settings.get('settings')
  if (existing) return existing
  const s = defaultSettings()
  await db.settings.put(s)
  return s
}

export { defaultSettings }
