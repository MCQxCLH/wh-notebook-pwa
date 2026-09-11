import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { User } from 'firebase/auth'
import { db, ensureSettings } from '../db/database'
import type { Lang } from '../db/types'
import {
  authErrorMessage,
  getCurrentEmailUser,
  isFirebaseConfigured,
  registerWithEmail,
  signInWithEmail,
  signOutUser,
  subscribeAuth,
} from '../sync/firebase'
import {
  applyAuthenticatedUser,
  pushAllLocal,
  pushSettingsPartial,
  startSync,
  stopSync,
  upsertSelfRoomMember,
} from '../sync/syncService'
import { generateRoomCode, normalizeRoomCode } from '../utils/roomCode'
import { RoomMembersList } from '../components/RoomMembersList'
import i18n from '../i18n'

const PRESET_CURRENCIES = ['HKD', 'AUD'] as const

export function SettingsPage() {
  const { t } = useTranslation()
  const settings = useLiveQuery(() => ensureSettings(), [])
  const members = useLiveQuery(
    () => db.roomMembers.filter((m) => !m.deleted).toArray(),
    [],
  )
  const [displayName, setDisplayName] = useState('')
  const [partnerName, setPartnerName] = useState('')
  const [currency, setCurrency] = useState('HKD')
  const [customCurrency, setCustomCurrency] = useState('')
  const [useOtherCurrency, setUseOtherCurrency] = useState(false)
  const [whStart, setWhStart] = useState('')
  const [whEnd, setWhEnd] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [copied, setCopied] = useState(false)
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>('default')
  const [msg, setMsg] = useState('')
  const [authUser, setAuthUser] = useState<User | null>(() => getCurrentEmailUser())
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [authMsg, setAuthMsg] = useState('')

  useEffect(() => {
    if (!settings) return
    setDisplayName(settings.displayName)
    setPartnerName(settings.partnerName ?? '')
    setWhStart(settings.whStart)
    setWhEnd(settings.whEnd)
    const c = (settings.currency || 'HKD').toUpperCase()
    if ((PRESET_CURRENCIES as readonly string[]).includes(c)) {
      setCurrency(c)
      setUseOtherCurrency(false)
      setCustomCurrency('')
    } else {
      setUseOtherCurrency(true)
      setCustomCurrency(settings.currency || '')
      setCurrency(settings.currency || '')
    }
  }, [settings])

  useEffect(() => {
    if (typeof Notification === 'undefined') setPerm('unsupported')
    else setPerm(Notification.permission)
  }, [])

  useEffect(() => {
    return subscribeAuth((u) => setAuthUser(u))
  }, [])

  const firebaseOk = isFirebaseConfigured()
  const signedIn = Boolean(authUser)

  async function persistSettings(partial: {
    displayName?: string
    partnerName?: string
    currency?: string
    whStart?: string
    whEnd?: string
  }) {
    if (!settings) return
    const next = {
      ...settings,
      displayName: (partial.displayName ?? displayName).trim() || 'Traveler',
      partnerName: (partial.partnerName ?? partnerName).trim(),
      currency: (partial.currency ?? currency).trim().toUpperCase() || 'HKD',
      whStart: partial.whStart ?? whStart,
      whEnd: partial.whEnd ?? whEnd,
      updatedAt: new Date().toISOString(),
    }
    await db.settings.put(next)
    await pushSettingsPartial(next)
    if (settings.roomCode && signedIn) {
      await upsertSelfRoomMember()
    }
    return next
  }

  async function saveGeneral() {
    const cur = useOtherCurrency
      ? customCurrency.trim().toUpperCase() || 'HKD'
      : currency
    await persistSettings({ currency: cur })
    setCurrency(cur)
    setMsg(t('settings.save'))
  }

  async function selectCurrency(code: string) {
    setUseOtherCurrency(false)
    setCurrency(code)
    setCustomCurrency('')
    await persistSettings({ currency: code })
    setMsg(t('settings.savedCurrency', { code }))
  }

  async function selectOtherCurrency() {
    setUseOtherCurrency(true)
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

  function mapAuthError(err: unknown): string {
    const key = authErrorMessage(err)
    return t(`settings.authErrors.${key}`)
  }

  async function handleRegister() {
    if (!firebaseOk) {
      setAuthMsg(t('settings.firebaseMissing'))
      return
    }
    if (!email.trim() || password.length < 6) {
      setAuthMsg(t('settings.authErrors.weakPassword'))
      return
    }
    setAuthBusy(true)
    setAuthMsg('')
    try {
      const user = await registerWithEmail(email, password, displayName.trim() || undefined)
      await applyAuthenticatedUser(user)
      setPassword('')
      setAuthMsg(t('settings.authRegistered'))
    } catch (err) {
      setAuthMsg(mapAuthError(err))
    } finally {
      setAuthBusy(false)
    }
  }

  async function handleSignIn() {
    if (!firebaseOk) {
      setAuthMsg(t('settings.firebaseMissing'))
      return
    }
    if (!email.trim() || !password) {
      setAuthMsg(t('settings.authErrors.badCredentials'))
      return
    }
    setAuthBusy(true)
    setAuthMsg('')
    try {
      const user = await signInWithEmail(email, password)
      await applyAuthenticatedUser(user)
      setPassword('')
      setAuthMsg(t('settings.authSignedIn'))
    } catch (err) {
      setAuthMsg(mapAuthError(err))
    } finally {
      setAuthBusy(false)
    }
  }

  async function handleSignOut() {
    setAuthBusy(true)
    setAuthMsg('')
    try {
      stopSync()
      await signOutUser()
      setAuthMsg(t('settings.authSignedOut'))
    } catch (err) {
      setAuthMsg(mapAuthError(err))
    } finally {
      setAuthBusy(false)
    }
  }

  async function createRoom() {
    if (!settings) return
    if (!firebaseOk) {
      setMsg(t('settings.firebaseMissing'))
      return
    }
    if (!signedIn) {
      setMsg(t('settings.signInRequiredForRoom'))
      return
    }
    const code = generateRoomCode()
    const next = {
      ...settings,
      displayName: displayName.trim() || settings.displayName,
      partnerName: partnerName.trim(),
      roomCode: code,
      userId: authUser!.uid,
      updatedAt: new Date().toISOString(),
    }
    await db.settings.put(next)
    await startSync()
    await upsertSelfRoomMember()
    await pushAllLocal()
    setMsg(t('settings.created'))
  }

  async function joinRoom() {
    if (!settings) return
    if (!firebaseOk) {
      setMsg(t('settings.firebaseMissing'))
      return
    }
    if (!signedIn) {
      setMsg(t('settings.signInRequiredForRoom'))
      return
    }
    const code = normalizeRoomCode(joinCode)
    if (code.length < 4) return
    const next = {
      ...settings,
      displayName: displayName.trim() || settings.displayName,
      partnerName: partnerName.trim(),
      roomCode: code,
      userId: authUser!.uid,
      updatedAt: new Date().toISOString(),
    }
    await db.settings.put(next)
    await startSync()
    await upsertSelfRoomMember()
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
    await db.roomMembers.clear()
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

  const activeCurrency = useOtherCurrency
    ? customCurrency.trim().toUpperCase()
    : currency

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
          <label>{t('settings.partnerName')}</label>
          <input
            value={partnerName}
            onChange={(e) => setPartnerName(e.target.value)}
            placeholder={t('settings.partnerNamePlaceholder')}
          />
        </div>
        <div className="field">
          <label>{t('settings.currency')}</label>
          <div className="chip-row">
            {PRESET_CURRENCIES.map((code) => (
              <button
                key={code}
                type="button"
                className={`chip${!useOtherCurrency && currency === code ? ' active' : ''}`}
                onClick={() => void selectCurrency(code)}
              >
                {code}
              </button>
            ))}
            <button
              type="button"
              className={`chip${useOtherCurrency ? ' active' : ''}`}
              onClick={() => void selectOtherCurrency()}
            >
              {t('settings.currencyOther')}
            </button>
          </div>
          {useOtherCurrency ? (
            <input
              style={{ marginTop: 8 }}
              value={customCurrency}
              onChange={(e) => setCustomCurrency(e.target.value.toUpperCase())}
              placeholder="JPY"
              maxLength={6}
            />
          ) : null}
          <div className="muted" style={{ fontSize: '0.78rem', marginTop: 4 }}>
            {t('settings.currencyDefaultHint', { code: activeCurrency || 'HKD' })}
          </div>
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
        <strong>{t('settings.account')}</strong>
        <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
          {t('settings.accountHint')}
        </p>
        {signedIn && authUser ? (
          <>
            <div className="field">
              <label>{t('settings.accountEmail')}</label>
              <div>{authUser.email}</div>
            </div>
            <div className="field">
              <label>{t('settings.displayName')}</label>
              <div>{authUser.displayName || displayName || '—'}</div>
            </div>
            <button
              type="button"
              className="btn secondary"
              disabled={authBusy}
              onClick={() => void handleSignOut()}
            >
              {t('settings.signOut')}
            </button>
          </>
        ) : (
          <>
            <div className="field">
              <label>{t('settings.accountEmail')}</label>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <div className="field">
              <label>{t('settings.accountPassword')}</label>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <div className="row">
              <button
                type="button"
                className="btn grow"
                disabled={authBusy || !firebaseOk}
                onClick={() => void handleRegister()}
              >
                {t('settings.register')}
              </button>
              <button
                type="button"
                className="btn secondary grow"
                disabled={authBusy || !firebaseOk}
                onClick={() => void handleSignIn()}
              >
                {t('settings.signIn')}
              </button>
            </div>
          </>
        )}
        {authMsg ? <div className="muted">{authMsg}</div> : null}
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
        {!signedIn ? (
          <div className="muted" style={{ fontSize: '0.85rem' }}>
            {t('settings.signInRequiredForRoom')}
          </div>
        ) : null}
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
            <RoomMembersList members={members ?? []} meId={settings.userId} />
            <button type="button" className="btn danger" onClick={() => void leaveRoom()}>
              {t('settings.leaveRoom')}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn"
              disabled={!signedIn}
              onClick={() => void createRoom()}
            >
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
                disabled={!signedIn}
              />
              <button
                type="button"
                className="btn secondary"
                disabled={!signedIn}
                onClick={() => void joinRoom()}
              >
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
