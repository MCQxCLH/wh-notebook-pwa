# Working Holiday Notebook (打工度假手帳)

Mobile-first Progressive Web App for two people on a working holiday: shared **to-dos**, **reminders**, **journal**, and **money tracker**.

- UI default: **Traditional Chinese (zh-Hant)** with English toggle
- Local-first: **IndexedDB (Dexie)** — works offline / without Firebase
- Optional **Firebase Auth (anonymous) + Firestore** real-time room sync
- Installable PWA (manifest + service worker via `vite-plugin-pwa`)

## Live demo

GitHub Pages: https://mcqxclh.github.io/wh-notebook-pwa/

## Quick start (local)

```bash
git clone https://github.com/MCQxCLH/wh-notebook-pwa.git
cd wh-notebook-pwa
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173/wh-notebook-pwa/`).

### Production build

```bash
npm run build
npm run preview
```

## Install as PWA on Android Chrome

1. Open the deployed site (or a HTTPS preview) in Chrome.
2. Menu → **Install app** / **Add to Home screen**.
3. Launch from the home screen icon (standalone display).

## Features

| Tab | What you get |
|-----|----------------|
| 待辦 | Create / edit / complete / delete / reorder todos; optional reminder |
| 日誌 | Dated journal entries with threaded comments |
| 收支 | Income & expenses, running totals, weekly & monthly summaries, simple chart |
| 設定 | Language, currency (default HKD), WH period dates, notifications, create/join sync room |

## 2-user sync

Without Firebase env vars the app stays local-only. With Firebase configured, create or join a short room code in Settings. See **[SETUP.md](./SETUP.md)**.

## Tech

- Vite + React + TypeScript
- Dexie (IndexedDB)
- i18next
- Recharts
- Firebase (optional)
- vite-plugin-pwa

## Deploy

Pushing to `main` runs `.github/workflows/deploy.yml` and deploys `dist/` to GitHub Pages (`base: /wh-notebook-pwa/`).

## Deploy notes

- **GitHub Pages** is configured from the `gh-pages` branch (static `dist/` output). Expected URL: https://mcqxclh.github.io/wh-notebook-pwa/
- The Actions workflow is saved as [`deploy.github-actions.yml`](./deploy.github-actions.yml). To enable auto-deploy on push to `main`, copy it to `.github/workflows/deploy.yml` (requires a GitHub token/PAT with the `workflow` scope) and switch Pages source to **GitHub Actions**.
