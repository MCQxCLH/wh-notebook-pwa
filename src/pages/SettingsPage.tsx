import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { db, ensureSettings } from '../db/database'
import type { Lang } from '../db/types'
import { isFirebaseConfigured } from '../sync/firebase'
import { pushAllLocal, pushSettingsPartial, startSync, stopSync } from '../sync/syncService'
import { generateRoomCode, normalizeRoomCode } from '../utils/roomCode'
import i18n from '../i18n'

export function SettingsPage() {
  const { t } = useTranslation()
  const settings = useLiveQuery(() => ensureSettings(), [])
  const [displayName, setDisplayName] = useState('')
  const [currency, setCurrency] = useState('HKD')
  const [whStart, setWhStart] = useState('')
  const [whEnd, setWhEnd] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [copied, setCopied] = useState(false)
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>('default')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!settings) return
    setDisplayName(settings.displayName)
    setCurrency(settings.currency)
    setWhStart(settings.whStart)
    setWhEnd(settings.whEnd)
  }, [settings])

  useEffect(() => {
    if (typeof Notification === 'undefined') setPerm('unsupported')
    else setPerm(Notification.permission)
  }, [])

  const firebaseOk = isFirebaseConfigured()

  async function saveGeneral() {
    if (!settings) return
    const next = {
      ...settings,
      displayName: displayName.trim() || 'Traveler',
      currency: currency.trim() || 'HKD',
      whStart,
      whEnd,
      updatedAt: new Date().toISOString(),
    }
    await db.settings.put(next)
    await pushSettingsPartial(next)
    setMsg(t('settings.save'))
  }

  async function setLanguage(lang: Lang) {
    if (!settings) return
    await i18n.changeLanguage(lang)
    const next = { ...settings, language: lang, updatedAt: new Date().toISOString() }
    await db.settings.put(next)
    await pushSettingsPartial(next)
  }

  async function requestNotif() {
    if (typeof Notification === 'undefined') return
    const result = await Notification.requestPermission()
    setPerm(result)
    if (settings) {
      await db.settings.put({
        ...settings,
        notificationPermissionAsked: true,
        updatedAt: new Date().toISOString(),
      })
    }
  }

  async function createRoom() {
    if (!settings) return
    if (!firebaseOk) {
      setMsg(t('settings.firebaseMissing'))
      return
    }
    const code = generateRoomCode()
    const next = {
      ...settings,
      roomCode: code,
      updatedAt: new Date().toISOString(),
    }
    await db.settings.put(next)
    await startSync()
    await pushAllLocal()
    setMsg(t('settings.created'))
  }

  async function joinRoom() {
    if (!settings) return
    if (!firebaseOk) {
      setMsg(t('settings.firebaseMissing'))
      return
    }
    const code = normalizeRoomCode(joinCode)
    if (code.length < 4) return
    const next = {
      ...settings,
      roomCode: code,
      updatedAt: new Date().toISOString(),
    }
    await db.settings.put(next)
    await startSync()
    await pushAllLocal()
    setMsg(t('settings.joined'))
  }

  async function leaveRoom() {
    if (!settings) return
    stopSync()
    await db.settings.put({
      ...settings,
      roomCode: null,
      updatedAt: new Date().toISOString(),
    })
    setMsg(t('settings.leaveRoom'))
  }

  async function copyCode() {
    if (!settings?.roomCode) return
    try {
      await navigator.clipboard.writeText(settings.roomCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  const permLabel =
    perm === 'granted'
      ? t('settings.permissionGranted')
      : perm === 'denied'
        ? t('settings.permissionDenied')
        : perm === 'unsupported'
          ? 'N/A'
          : t('settings.permissionDefault')

  if (!settings) return <div className="card">{t('common.loading')}</div>

  return (
    <>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>{t('settings.title')}</h2>
        <div className="field">
          <label>{t('settings.language')}</label>
          <div className="chip-row">
            <button
              type="button"
              className={`chip${settings.language === 'zh-Hant' ? ' active' : ''}`}
              onClick={() => void setLanguage('zh-Hant')}
            >
              繁體中文
            </button>
            <button
              type="button"
              className={`chip${settings.language === 'en' ? ' active' : ''}`}
              onClick={() => void setLanguage('en')}
            >
              English
            </button>
          </div>
        </div>
        <div className="field">
          <label>{t('settings.displayName')}</label>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div className="field">
          <label>{t('settings.currency')}</label>
          <input value={currency} onChange={(e) => setCurrency(e.target.value)} />
        </div>
        <div className="field">
          <label>{t('settings.whPeriod')}</label>
          <div className="row">
            <input type="date" value={whStart} onChange={(e) => setWhStart(e.target.value)} />
            <span>→</span>
            <input type="date" value={whEnd} onChange={(e) => setWhEnd(e.target.value)} />
          </div>
        </div>
        <button type="button" className="btn" onClick={() => void saveGeneral()}>
          {t('settings.save')}
        </button>
        {msg ? <div className="muted">{msg}</div> : null}
      </div>

      <div className="card stack">
        <strong>{t('settings.notifications')}</strong>
        <div className="muted">{permLabel}</div>
        <p className="muted" style={{ margin: 0 }}>
          {t('reminders.limitation')}
        </p>
        <button type="button" className="btn secondary" onClick={() => void requestNotif()}>
          {t('settings.requestPermission')}
        </button>
      </div>

      <div className="card stack">
        <strong>{t('settings.sync')}</strong>
        <div className="muted">
          {firebaseOk ? t('settings.firebaseReady') : t('settings.firebaseMissing')}
        </div>
        {settings.roomCode ? (
          <>
            <div className="row between">
              <div>
                <div className="muted">{t('settings.roomCode')}</div>
                <strong style={{ letterSpacing: '0.12em', fontSize: '1.2rem' }}>
                  {settings.roomCode}
                </strong>
              </div>
              <button type="button" className="btn secondary small" onClick={() => void copyCode()}>
                {copied ? t('settings.copied') : t('settings.copyCode')}
              </button>
            </div>
            <button type="button" className="btn danger" onClick={() => void leaveRoom()}>
              {t('settings.leaveRoom')}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn" onClick={() => void createRoom()}>
              {t('settings.createRoom')}
            </button>
            <div className="row">
              <input
                className="grow"
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  padding: '10px 12px',
                  textTransform: 'uppercase',
                }}
                placeholder={t('settings.roomCode')}
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
              />
              <button type="button" className="btn secondary" onClick={() => void joinRoom()}>
                {t('settings.joinRoom')}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="card stack">
        <strong>{t('settings.about')}</strong>
        <p className="muted" style={{ margin: 0 }}>
          {t('settings.aboutText')}
        </p>
      </div>
    </>
  )
}
