import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { BottomNav, type TabId } from './BottomNav'

type SyncStatusLike = 'local' | 'connecting' | 'synced' | 'error'

interface Props {
  tab: TabId
  onTab: (t: TabId) => void
  syncStatus: SyncStatusLike
  children: ReactNode
}

export function Layout({ tab, onTab, syncStatus, children }: Props) {
  const { t } = useTranslation()
  const badgeClass =
    syncStatus === 'synced' ? 'synced' : syncStatus === 'error' ? 'error' : ''
  const badgeText =
    syncStatus === 'synced'
      ? t('common.synced')
      : syncStatus === 'local'
        ? t('settings.localOnly').split('（')[0]
        : syncStatus === 'connecting'
          ? t('common.loading')
          : t('common.error')

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>{t('appName')}</h1>
        <span className={`badge ${badgeClass}`}>{badgeText}</span>
      </header>
      <main className="page">{children}</main>
      <BottomNav tab={tab} onChange={onTab} />
    </div>
  )
}
