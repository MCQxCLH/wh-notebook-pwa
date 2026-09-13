import { useTranslation } from 'react-i18next'
import type { RoomMember } from '../db/types'
import { removeRoomMember } from '../sync/syncService'

export function RoomMembersList({
  members,
  meId,
  compact,
  allowRemove,
  onRemoved,
}: {
  members: RoomMember[]
  meId: string | null | undefined
  compact?: boolean
  /** Show remove button for others (Settings). */
  allowRemove?: boolean
  onRemoved?: () => void
}) {
  const { t } = useTranslation()
  const sorted = [...members].filter((m) => !m.deleted).sort((a, b) => {
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
      {sorted.length === 0 ? (
        <div className="muted">{t('settings.waitingPartner')}</div>
      ) : (
        <ul className="members-ul">
          {sorted.map((m) => {
            const isMe = Boolean(meId && m.id === meId)
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
