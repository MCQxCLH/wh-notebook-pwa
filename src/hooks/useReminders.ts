import { useEffect } from 'react'
import { db } from '../db/database'

const CHECK_MS = 30_000

async function fireDueReminders() {
  const now = new Date().toISOString()
  const due = await db.reminders
    .filter((r) => !r.deleted && !r.fired && r.at <= now)
    .toArray()

  for (const r of due) {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification(r.title, {
          body: r.body || '',
          icon: `${import.meta.env.BASE_URL}icons/icon-192.png`,
          tag: r.id,
        })
      } catch {
        // ignore
      }
    }
    await db.reminders.update(r.id, {
      fired: true,
      updatedAt: new Date().toISOString(),
    })
  }
}

export function useReminders() {
  useEffect(() => {
    void fireDueReminders()
    const id = window.setInterval(() => {
      void fireDueReminders()
    }, CHECK_MS)
    const onVis = () => {
      if (document.visibilityState === 'visible') void fireDueReminders()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])
}
