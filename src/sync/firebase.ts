import { initializeApp, type FirebaseApp } from 'firebase/app'
import {
  getAuth,
  signInAnonymously,
  type Auth,
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

export async function ensureAnonymousAuth(): Promise<string | null> {
  const fb = getFirebase()
  if (!fb) return null
  if (fb.auth.currentUser) return fb.auth.currentUser.uid
  const cred = await signInAnonymously(fb.auth)
  return cred.user.uid
}
