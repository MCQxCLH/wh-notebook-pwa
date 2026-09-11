import { useEffect, useState } from 'react'
import { getSyncStatus, onSyncStatus, startSync, stopSync } from '../sync/syncService'
import { ensureSettings } from '../db/database'
import { subscribeAuth } from '../sync/firebase'

export function useSync() {
  const [status, setStatus] = useState(getSyncStatus())

  useEffect(() => {
    const offStatus = onSyncStatus(setStatus)
    let cancelled = false

    const offAuth = subscribeAuth((user) => {
      void (async () => {
        if (cancelled) return
        await ensureSettings()
        if (user) {
          await startSync()
        } else {
          stopSync()
        }
      })()
    })

    return () => {
      cancelled = true
      offStatus()
      offAuth()
    }
  }, [])

  return status
}
