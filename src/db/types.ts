export type Lang = 'zh-Hant' | 'en'

export interface Todo {
  id: string
  title: string
  notes?: string
  completed: boolean
  order: number
  reminderAt?: string | null
  createdAt: string
  updatedAt: string
  deleted?: boolean
}

export interface Reminder {
  id: string
  title: string
  body?: string
  at: string
  todoId?: string | null
  fired: boolean
  createdAt: string
  updatedAt: string
  deleted?: boolean
}

export interface JournalEntry {
  id: string
  date: string // YYYY-MM-DD
  title: string
  body: string
  createdAt: string
  updatedAt: string
  deleted?: boolean
}

export interface JournalComment {
  id: string
  entryId: string
  author: string
  body: string
  createdAt: string
  updatedAt: string
  deleted?: boolean
}

export type MoneyType = 'income' | 'expense'
/** Entry currency — each money row stores its own. */
export type EntryCurrency = 'HKD' | 'AUD'
/**
 * personal = only payer's expense
 * equal = shared equally among participants
 * custom = absolute shares in `shares` (userId → amount)
 * Legacy value `shared` is treated as `equal`.
 */
export type SplitMode = 'personal' | 'equal' | 'custom'

export interface MoneyEntry {
  id: string
  type: MoneyType
  amount: number
  category: string
  note?: string
  date: string // YYYY-MM-DD
  createdAt: string
  updatedAt: string
  deleted?: boolean
  /** Per-entry currency. Missing → treat as settings default or HKD. */
  currency?: EntryCurrency | string
  paidById?: string
  paidByName?: string
  /** Legacy records may still have `shared` — treat as equal. */
  splitMode?: SplitMode | 'shared'
  participantIds?: string[]
  participantNames?: string[]
  /** Custom split: absolute amount each participant owes (must sum ≈ amount). */
  shares?: Record<string, number>
}

export interface RoomMember {
  id: string
  displayName: string
  updatedAt: string
  /** Soft-deleted after identity migration (old random userId). */
  deleted?: boolean
}

export interface AppSettings {
  id: 'settings'
  language: Lang
  /** Default currency for *new* entries only (not a global display switch). */
  currency: string
  whStart: string
  whEnd: string
  displayName: string
  partnerName: string
  roomCode: string | null
  userId: string | null
  notificationPermissionAsked: boolean
  updatedAt: string
}

export type SyncCollection =
  | 'todos'
  | 'reminders'
  | 'journalEntries'
  | 'journalComments'
  | 'moneyEntries'
  | 'roomMembers'
  | 'settings'
