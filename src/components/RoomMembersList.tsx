import { useTranslation } from 'react-i18next'
import type { RoomMember } from '../db/types'

export function RoomMembersList({
  members,
  meId,
  compact,
}: {
  members: RoomMember[]
  meId: string | null | undefined
  compact?: boolean
}) {
  const { t } = useTranslation()
  const sorted = [...members].sort((a, b) => {
    if (meId && a.id === meId) return -1
    if (meId && b.id === meId) return 1
    return a.displayName.localeCompare(b.displayName)
  })

  return (
    <div className={`members-list${compact ? ' compact' : ''}`}>
      <div className="scope-heading">{t('settings.members')}</div>
      {sorted.length === 0 ? (
        <div className="muted">{t('settings.waitingPartner')}</div>
      ) : (
        <ul className="members-ul">
          {sorted.map((m) => (
            <li key={m.id} className="member-row">
              <span className="member-avatar" aria-hidden>
                {(m.displayName || '?').slice(0, 1).toUpperCase()}
              </span>
              <span className="member-name">
                {m.displayName || t('money.partner')}
                {meId && m.id === meId ? (
                  <span className="tag you-tag">{t('settings.you')}</span>
                ) : null}
              </span>
            </li>
          ))}
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
