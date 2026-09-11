import { initializeApp, type FirebaseApp } from 'firebase/app'
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type Auth,
  type User,
  type Unsubscribe,
} from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'

export interface FirebaseBundle {
  app: FirebaseApp
  auth: Auth
  db: Firestore
}

function readConfig() {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY as string | undefined
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined
  const storageBucket = import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined
  const messagingSenderId = import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined
  const appId = import.meta.env.VITE_FIREBASE_APP_ID as string | undefined

  if (!apiKey || !projectId || !appId) return null
  if (apiKey.includes('YOUR_') || apiKey === 'placeholder') return null

  return {
    apiKey,
    authDomain: authDomain || `${projectId}.firebaseapp.com`,
    projectId,
    storageBucket: storageBucket || `${projectId}.appspot.com`,
    messagingSenderId: messagingSenderId || '',
    appId,
  }
}

let bundle: FirebaseBundle | null = null
let initAttempted = false

export function isFirebaseConfigured(): boolean {
  return readConfig() !== null
}

export function getFirebase(): FirebaseBundle | null {
  if (bundle) return bundle
  if (initAttempted) return null
  initAttempted = true
  const config = readConfig()
  if (!config) return null
  const app = initializeApp(config)
  const auth = getAuth(app)
  const db = getFirestore(app)
  bundle = { app, auth, db }
  return bundle
}

/** True when Firebase Auth user is email/password (not anonymous). */
export function isEmailUser(user: User | null | undefined): boolean {
  if (!user) return false
  if (user.isAnonymous) return false
  return (user.providerData ?? []).some((p) => p.providerId === 'password') || Boolean(user.email)
}

export function getCurrentEmailUser(): User | null {
  const fb = getFirebase()
  if (!fb) return null
  const u = fb.auth.currentUser
  return isEmailUser(u) ? u : null
}

/**
 * Require a signed-in email/password user for room sync and money identity.
 * Does NOT fall back to anonymous.
 */
export async function ensureSignedInUser(): Promise<User | null> {
  const fb = getFirebase()
  if (!fb) return null
  const current = fb.auth.currentUser
  if (isEmailUser(current)) return current
  // Wait briefly for auth restore from IndexedDB persistence
  const restored = await new Promise<User | null>((resolve) => {
    let done = false
    const finish = (u: User | null) => {
      if (done) return
      done = true
      unsub()
      resolve(u)
    }
    const unsub = onAuthStateChanged(fb.auth, (u) => {
      if (isEmailUser(u)) finish(u)
    })
    setTimeout(() => finish(isEmailUser(fb.auth.currentUser) ? fb.auth.currentUser : null), 1500)
  })
  return restored
}

/** Anonymous only as non-critical fallback (not used for room sync / money id). */
export async function ensureAnonymousAuth(): Promise<string | null> {
  const fb = getFirebase()
  if (!fb) return null
  if (fb.auth.currentUser) return fb.auth.currentUser.uid
  const cred = await signInAnonymously(fb.auth)
  return cred.user.uid
}

export async function registerWithEmail(
  email: string,
  password: string,
  displayName?: string,
): Promise<User> {
  const fb = getFirebase()
  if (!fb) throw new Error('Firebase not configured')
  const cred = await createUserWithEmailAndPassword(fb.auth, email.trim(), password)
  if (displayName?.trim()) {
    await updateProfile(cred.user, { displayName: displayName.trim() })
  }
  return cred.user
}

export async function signInWithEmail(email: string, password: string): Promise<User> {
  const fb = getFirebase()
  if (!fb) throw new Error('Firebase not configured')
  const cred = await signInWithEmailAndPassword(fb.auth, email.trim(), password)
  return cred.user
}

export async function signOutUser(): Promise<void> {
  const fb = getFirebase()
  if (!fb) return
  await signOut(fb.auth)
}

export function subscribeAuth(cb: (user: User | null) => void): Unsubscribe {
  const fb = getFirebase()
  if (!fb) {
    cb(null)
    return () => {}
  }
  return onAuthStateChanged(fb.auth, (u) => {
    cb(isEmailUser(u) ? u : null)
  })
}

export function authErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code || ''
  switch (code) {
    case 'auth/email-already-in-use':
      return 'emailInUse'
    case 'auth/invalid-email':
      return 'invalidEmail'
    case 'auth/weak-password':
      return 'weakPassword'
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'badCredentials'
    case 'auth/too-many-requests':
      return 'tooManyRequests'
    case 'auth/operation-not-allowed':
      return 'providerDisabled'
    case 'auth/network-request-failed':
      return 'network'
    default:
      return 'unknown'
  }
}
