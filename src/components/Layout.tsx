import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { BottomNav, type TabId } from './BottomNav'
import { retrySync } from '../sync/syncService'

type SyncStatusLike = 'local' | 'connecting' | 'synced' | 'error'

interface Props {
  tab: TabId
  onTab: (t: TabId) => void
  syncStatus: SyncStatusLike
  roomCode?: string | null
  accountLabel?: string | null
  children: ReactNode
}

export function Layout({
  tab,
  onTab,
  syncStatus,
  roomCode,
  accountLabel,
  children,
}: Props) {
  const { t } = useTranslation()
  const badgeClass =
    syncStatus === 'synced'
      ? 'synced'
      : syncStatus === 'error'
        ? 'error'
        : syncStatus === 'connecting'
          ? 'connecting'
          : ''
  const badgeText =
    syncStatus === 'synced'
      ? t('common.synced')
      : syncStatus === 'local'
        ? t('common.local')
        : syncStatus === 'connecting'
          ? t('common.connecting')
          : t('common.error')

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-left">
          <h1>{t('appName')}</h1>
          {roomCode || accountLabel ? (
            <div className="sync-meta">
              {roomCode ? (
                <span className="sync-room" title={t('settings.roomCode')}>
                  {roomCode}
                </span>
              ) : null}
              {accountLabel ? (
                <span className="sync-account" title={accountLabel}>
                  {accountLabel}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="header-right">
          <span className={`badge ${badgeClass}`}>{badgeText}</span>
          {syncStatus === 'error' ? (
            <button
              type="button"
              className="btn secondary small"
              onClick={() => void retrySync()}
            >
              {t('common.retry')}
            </button>
          ) : null}
        </div>
      </header>
      <main className="page">{children}</main>
      <BottomNav tab={tab} onChange={onTab} />
    </div>
  )
}
