import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Layout } from './components/Layout'
import type { TabId } from './components/BottomNav'
import { TodosPage } from './pages/TodosPage'
import { JournalPage } from './pages/JournalPage'
import { MoneyPage } from './pages/MoneyPage'
import { SettingsPage } from './pages/SettingsPage'
import { ensureSettings } from './db/database'
import { useReminders } from './hooks/useReminders'
import { useSync } from './hooks/useSync'
import i18n from './i18n'

export type SyncStatusLike = 'local' | 'connecting' | 'synced' | 'error'

export default function App() {
  const [tab, setTab] = useState<TabId>('todos')
  const [ready, setReady] = useState(false)
  const syncStatus = useSync()
  useReminders()
  const { t } = useTranslation()

  useEffect(() => {
    void (async () => {
      const s = await ensureSettings()
      if (s.language && s.language !== i18n.language) {
        await i18n.changeLanguage(s.language)
      }
      setReady(true)
    })()
  }, [])

  if (!ready) {
    return (
      <div className="app-shell">
        <div className="page">
          <div className="card empty">{t('common.loading')}</div>
        </div>
      </div>
    )
  }

  return (
    <Layout tab={tab} onTab={setTab} syncStatus={syncStatus}>
      {tab === 'todos' ? <TodosPage /> : null}
      {tab === 'journal' ? <JournalPage /> : null}
      {tab === 'money' ? <MoneyPage /> : null}
      {tab === 'settings' ? <SettingsPage /> : null}
    </Layout>
  )
}
