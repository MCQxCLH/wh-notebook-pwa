import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { User } from 'firebase/auth'
import { db, ensureSettings } from '../db/database'
import {
  authErrorMessage,
  getCurrentEmailUser,
  isFirebaseConfigured,
  registerWithEmail,
  signInWithEmail,
  subscribeAuth,
} from '../sync/firebase'
import {
  applyAuthenticatedUser,
  pushAllLocal,
  startSync,
  upsertSelfRoomMember,
} from '../sync/syncService'
import { generateRoomCode, normalizeRoomCode } from '../utils/roomCode'

interface Props {
  onDone: () => void
}

export function Onboarding({ onDone }: Props) {
  const { t } = useTranslation()
  const [step, setStep] = useState(1)
  const [authUser, setAuthUser] = useState<User | null>(() => getCurrentEmailUser())
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const firebaseOk = isFirebaseConfigured()

  useEffect(() => {
    return subscribeAuth((u) => {
      setAuthUser(u)
      if (u) setStep((s) => (s < 2 ? 2 : s))
    })
  }, [])

  useEffect(() => {
    void (async () => {
      const s = await ensureSettings()
      if (s.displayName && s.displayName !== 'Traveler') {
        setDisplayName(s.displayName)
      }
      if (authUser && s.roomCode) {
        // Already fully set up
        await markDone()
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function markDone() {
    const s = await ensureSettings()
    await db.settings.put({
      ...s,
      onboardingDone: true,
      updatedAt: new Date().toISOString(),
    })
    onDone()
  }

  async function skip() {
    await markDone()
  }

  function mapAuthError(err: unknown): string {
    return t(`settings.authErrors.${authErrorMessage(err)}`)
  }

  async function handleRegister() {
    if (!firebaseOk) {
      setMsg(t('settings.firebaseMissing'))
      return
    }
    if (!email.trim() || password.length < 6) {
      setMsg(t('settings.authErrors.weakPassword'))
      return
    }
    setBusy(true)
    setMsg('')
    try {
      const user = await registerWithEmail(email, password, displayName.trim() || undefined)
      await applyAuthenticatedUser(user)
      setPassword('')
      setStep(2)
    } catch (err) {
      setMsg(mapAuthError(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleSignIn() {
    if (!firebaseOk) {
      setMsg(t('settings.firebaseMissing'))
      return
    }
    if (!email.trim() || !password) {
      setMsg(t('settings.authErrors.badCredentials'))
      return
    }
    setBusy(true)
    setMsg('')
    try {
      const user = await signInWithEmail(email, password)
      await applyAuthenticatedUser(user)
      setPassword('')
      const s = await ensureSettings()
      if (s.roomCode) {
        await markDone()
      } else {
        setStep(2)
      }
    } catch (err) {
      setMsg(mapAuthError(err))
    } finally {
      setBusy(false)
    }
  }

  async function saveDisplayName() {
    const name = displayName.trim() || 'Traveler'
    const s = await ensureSettings()
    await db.settings.put({
      ...s,
      displayName: name,
      updatedAt: new Date().toISOString(),
    })
    if (s.roomCode && authUser) {
      await upsertSelfRoomMember()
    }
    setStep(3)
  }

  async function createRoom() {
    if (!authUser) {
      setMsg(t('settings.signInRequiredForRoom'))
      return
    }
    setBusy(true)
    setMsg('')
    try {
      const s = await ensureSettings()
      const code = generateRoomCode()
      const name = displayName.trim() || s.displayName
      await db.settings.put({
        ...s,
        displayName: name,
        roomCode: code,
        userId: authUser.uid,
        onboardingDone: true,
        updatedAt: new Date().toISOString(),
      })
      await startSync()
      await upsertSelfRoomMember()
      await pushAllLocal()
      onDone()
    } catch (err) {
      console.error(err)
      setMsg(t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  async function joinRoom() {
    if (!authUser) {
      setMsg(t('settings.signInRequiredForRoom'))
      return
    }
    const code = normalizeRoomCode(joinCode)
    if (code.length < 4) return
    setBusy(true)
    setMsg('')
    try {
      const s = await ensureSettings()
      const name = displayName.trim() || s.displayName
      await db.settings.put({
        ...s,
        displayName: name,
        roomCode: code,
        userId: authUser.uid,
        onboardingDone: true,
        updatedAt: new Date().toISOString(),
      })
      await startSync()
      await upsertSelfRoomMember()
      await pushAllLocal()
      onDone()
    } catch (err) {
      console.error(err)
      setMsg(t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="onboarding-backdrop">
      <div className="onboarding-card stack">
        <div className="row between">
          <h2 style={{ margin: 0 }}>{t('onboarding.title')}</h2>
          <button type="button" className="btn ghost small" onClick={() => void skip()}>
            {t('onboarding.skip')}
          </button>
        </div>
        <div className="onboarding-steps">
          {[1, 2, 3].map((n) => (
            <span key={n} className={`onboarding-dot${step === n ? ' active' : step > n ? ' done' : ''}`}>
              {n}
            </span>
          ))}
        </div>

        {step === 1 ? (
          <div className="stack">
            <strong>{t('onboarding.step1')}</strong>
            <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
              {t('onboarding.step1Hint')}
            </p>
            {authUser ? (
              <>
                <div className="muted">{authUser.email}</div>
                <button type="button" className="btn" onClick={() => setStep(2)}>
                  {t('onboarding.next')}
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
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>
                <div className="row">
                  <button
                    type="button"
                    className="btn grow"
                    disabled={busy || !firebaseOk}
                    onClick={() => void handleRegister()}
                  >
                    {t('settings.register')}
                  </button>
                  <button
                    type="button"
                    className="btn secondary grow"
                    disabled={busy || !firebaseOk}
                    onClick={() => void handleSignIn()}
                  >
                    {t('settings.signIn')}
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="stack">
            <strong>{t('onboarding.step2')}</strong>
            <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
              {t('onboarding.step2Hint')}
            </p>
            <div className="field">
              <label>{t('settings.displayName')}</label>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Traveler"
              />
            </div>
            <button type="button" className="btn" onClick={() => void saveDisplayName()}>
              {t('onboarding.next')}
            </button>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="stack">
            <strong>{t('onboarding.step3')}</strong>
            <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
              {t('onboarding.step3Hint')}
            </p>
            <button
              type="button"
              className="btn"
              disabled={busy || !authUser}
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
                disabled={!authUser}
              />
              <button
                type="button"
                className="btn secondary"
                disabled={busy || !authUser}
                onClick={() => void joinRoom()}
              >
                {t('settings.joinRoom')}
              </button>
            </div>
            <button type="button" className="btn ghost" onClick={() => void skip()}>
              {t('onboarding.later')}
            </button>
          </div>
        ) : null}

        {msg ? <div className="muted">{msg}</div> : null}
      </div>
    </div>
  )
}
