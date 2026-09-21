import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { RoomMember } from '../db/types'
import { removeRoomMember } from '../sync/syncService'
import { duplicateDisplayNameGroups, normalizeDisplayName } from '../utils/identity'

export function RoomMembersList({
  members,
  meId,
  compact,
  allowRemove,
  onRemoved,
  showDuplicateHint,
}: {
  members: RoomMember[]
  meId: string | null | undefined
  compact?: boolean
  /** Show remove button for others (Settings). */
  allowRemove?: boolean
  onRemoved?: () => void
  /** Show hint when multiple members share a display name. */
  showDuplicateHint?: boolean
}) {
  const { t } = useTranslation()
  const active = useMemo(
    () => members.filter((m) => !m.deleted),
    [members],
  )

  const dupNames = useMemo(
    () => (showDuplicateHint ? duplicateDisplayNameGroups(active) : []),
    [active, showDuplicateHint],
  )

  const nameCounts = useMemo(() => {
    const c = new Map<string, number>()
    for (const m of active) {
      const k = normalizeDisplayName(m.displayName)
      c.set(k, (c.get(k) || 0) + 1)
    }
    return c
  }, [active])

  const sorted = [...active].sort((a, b) => {
    if (meId && a.id === meId) return -1
    if (meId && b.id === meId) return 1
    return a.displayName.localeCompare(b.displayName)
  })

  async function handleRemove(m: RoomMember) {
    const name = m.displayName || t('money.partner')
    if (!confirm(t('settings.confirmRemoveMember', { name }))) return
    await removeRoomMember(m.id)
    onRemoved?.()
  }

  return (
    <div className={`members-list${compact ? ' compact' : ''}`}>
      <div className="scope-heading">{t('settings.members')}</div>
      {dupNames.length > 0 ? (
        <div className="muted" style={{ fontSize: '0.78rem', color: 'var(--danger, #c45c5c)' }}>
          {t('settings.duplicateNamesHint', { names: dupNames.join(', ') })}
        </div>
      ) : null}
      {sorted.length === 0 ? (
        <div className="muted">{t('settings.waitingPartner')}</div>
      ) : (
        <ul className="members-ul">
          {sorted.map((m) => {
            const isMe = Boolean(meId && m.id === meId)
            const dup =
              (nameCounts.get(normalizeDisplayName(m.displayName)) || 0) > 1
            return (
              <li key={m.id} className="member-row">
                <span className="member-avatar" aria-hidden>
                  {(m.displayName || '?').slice(0, 1).toUpperCase()}
                </span>
                <span className="member-name grow">
                  {m.displayName || t('money.partner')}
                  {isMe ? (
                    <span className="tag you-tag">{t('settings.you')}</span>
                  ) : null}
                  {dup && m.email ? (
                    <span className="muted" style={{ fontSize: '0.75rem', display: 'block' }}>
                      {m.email}
                    </span>
                  ) : null}
                  {dup && !m.email ? (
                    <span className="muted" style={{ fontSize: '0.7rem', display: 'block' }}>
                      id: {m.id.slice(0, 8)}…
                    </span>
                  ) : null}
                </span>
                {allowRemove && !isMe ? (
                  <button
                    type="button"
                    className="btn danger small"
                    onClick={() => void handleRemove(m)}
                  >
                    {t('settings.removeMember')}
                  </button>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
      {sorted.length === 1 ? (
        <div className="muted" style={{ fontSize: '0.78rem', marginTop: 4 }}>
          {t('settings.waitingPartner')}
        </div>
      ) : null}
    </div>
  )
}
