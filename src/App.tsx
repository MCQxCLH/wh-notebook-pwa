import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { Layout } from './components/Layout'
import { Onboarding } from './components/Onboarding'
import type { TabId } from './components/BottomNav'
import { TodosPage } from './pages/TodosPage'
import { JournalPage } from './pages/JournalPage'
import { MoneyPage } from './pages/MoneyPage'
import { SettingsPage } from './pages/SettingsPage'
import { ensureSettings } from './db/database'
import { useReminders } from './hooks/useReminders'
import { useSync } from './hooks/useSync'
import { getCurrentEmailUser, subscribeAuth } from './sync/firebase'
import i18n from './i18n'
import type { User } from 'firebase/auth'

export type SyncStatusLike = 'local' | 'connecting' | 'synced' | 'error'

export default function App() {
  const [tab, setTab] = useState<TabId>('todos')
  const [ready, setReady] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [authUser, setAuthUser] = useState<User | null>(() => getCurrentEmailUser())
  const syncStatus = useSync()
  useReminders()
  const { t } = useTranslation()
  const settings = useLiveQuery(() => ensureSettings(), [])

  useEffect(() => {
    void (async () => {
      const s = await ensureSettings()
      if (s.language && s.language !== i18n.language) {
        await i18n.changeLanguage(s.language)
      }
      const needsOnboarding =
        !s.onboardingDone && (!getCurrentEmailUser() || !s.roomCode)
      setShowOnboarding(needsOnboarding)
      setReady(true)
    })()
  }, [])

  useEffect(() => {
    return subscribeAuth((u) => setAuthUser(u))
  }, [])

  useEffect(() => {
    if (!settings || !ready) return
    // Hide if already signed in with room
    if (settings.onboardingDone) {
      setShowOnboarding(false)
      return
    }
    if (authUser && settings.roomCode) {
      setShowOnboarding(false)
    }
  }, [settings, authUser, ready])

  if (!ready) {
    return (
      <div className="app-shell">
        <div className="page">
          <div className="card empty">{t('common.loading')}</div>
        </div>
      </div>
    )
  }

  const accountLabel =
    authUser?.displayName?.trim() ||
    authUser?.email ||
    settings?.displayName ||
    null

  return (
    <>
      <Layout
        tab={tab}
        onTab={setTab}
        syncStatus={syncStatus}
        roomCode={settings?.roomCode}
        accountLabel={authUser ? accountLabel : null}
      >
        {tab === 'todos' ? <TodosPage /> : null}
        {tab === 'journal' ? <JournalPage /> : null}
        {tab === 'money' ? <MoneyPage /> : null}
        {tab === 'settings' ? <SettingsPage /> : null}
      </Layout>
      {showOnboarding ? (
        <Onboarding onDone={() => setShowOnboarding(false)} />
      ) : null}
    </>
  )
}
