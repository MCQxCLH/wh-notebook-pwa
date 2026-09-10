# Firebase setup for 2-user sync

The app works fully **without** Firebase (IndexedDB local-only). Follow this only when you want real-time sync between two people.

## 1. Create a Firebase project

1. Open [Firebase Console](https://console.firebase.google.com/) and create a project.
2. Add a **Web** app; copy the config values into `.env.local` (see `.env.example`).
3. Enable **Anonymous** authentication: Build → Authentication → Sign-in method → Anonymous → Enable.
4. Create a **Firestore** database (production or test mode to start).

## 2. Suggested Firestore rules (two users sharing a room code)

These rules allow any signed-in (anonymous) user who knows a room id to read/write that room. Room codes are short shared secrets — treat them like a household PIN.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /rooms/{roomId} {
      allow read, write: if request.auth != null;
      match /{subcollection}/{docId} {
        allow read, write: if request.auth != null;
      }
    }
  }
}
```

Tighten later (e.g. membership list) if you need stronger access control.

## 3. Local env

```bash
cp .env.example .env.local
# edit .env.local with real values (never commit secrets)
npm run dev
```

For GitHub Pages, set the same `VITE_FIREBASE_*` values as **repository Actions secrets** / variables and wire them into the deploy workflow `env:` block so the production build embeds them. Do not commit real keys to the repo if the project must stay private; for a public Pages site the web API key is visible in the client bundle by design — protect data with Firestore rules.

## 4. How sync works in the app

1. Person A opens **設定 → 建立房間** and shares the 6-character code.
2. Person B opens **設定 → 加入房間** and enters the code.
3. Both devices listen to `rooms/{code}/…` in Firestore and merge by `updatedAt`.
4. Soft deletes use a `deleted` flag so peers stay consistent.

## 5. Reminder limitation

Reminders use the **Web Notifications API** plus a periodic check while the tab/PWA is open. They are **not** reliable native Android alarms when the browser is fully killed.
