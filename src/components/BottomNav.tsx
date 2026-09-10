import { useTranslation } from 'react-i18next'

export type TabId = 'todos' | 'journal' | 'money' | 'settings'

interface Props {
  tab: TabId
  onChange: (tab: TabId) => void
}

const ICONS: Record<TabId, string> = {
  todos: '✓',
  journal: '✎',
  money: '¥',
  settings: '⚙',
}

export function BottomNav({ tab, onChange }: Props) {
  const { t } = useTranslation()
  const items: TabId[] = ['todos', 'journal', 'money', 'settings']

  return (
    <nav className="bottom-nav" aria-label="Primary">
      {items.map((id) => (
        <button
          key={id}
          type="button"
          className={`nav-item${tab === id ? ' active' : ''}`}
          onClick={() => onChange(id)}
        >
          <span className="icon" aria-hidden>
            {ICONS[id]}
          </span>
          <span>{t(`nav.${id}`)}</span>
        </button>
      ))}
    </nav>
  )
}
