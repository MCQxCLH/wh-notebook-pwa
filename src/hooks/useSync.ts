import { useEffect, useState } from 'react'
import { getSyncStatus, onSyncStatus, startSync } from '../sync/syncService'
import { ensureSettings } from '../db/database'

export function useSync() {
  const [status, setStatus] = useState(getSyncStatus())

  useEffect(() => {
    const off = onSyncStatus(setStatus)
    void (async () => {
      await ensureSettings()
      await startSync()
    })()
    return off
  }, [])

  return status
}
