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
export type SplitMode = 'personal' | 'shared'

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
  paidById?: string
  paidByName?: string
  splitMode?: SplitMode // default treat missing as 'personal'
  participantIds?: string[]
  participantNames?: string[]
}

export interface RoomMember {
  id: string
  displayName: string
  updatedAt: string
}

export interface AppSettings {
  id: 'settings'
  language: Lang
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
