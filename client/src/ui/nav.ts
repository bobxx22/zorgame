import { useCabinet } from '../app/cabinet-context'
import type { IconName } from './Icon'

export type NavCount = 'unread' | 'stages'

export interface NavItem {
  to: string
  label: string
  icon: IconName
  end?: boolean
  count?: NavCount
}

/** The bar: one item per screen, as the site's bar has one per section. */
export const NAV_TOP: readonly NavItem[] = [
  { to: '/', label: 'Ефір', icon: 'mast', end: true },
  { to: '/contact', label: "Вихід на зв'язок", icon: 'repo' },
  { to: '/inbox', label: 'Листи', icon: 'mail', count: 'unread' },
  { to: '/stages', label: 'Завдання', icon: 'parts', count: 'stages' },
  { to: '/news', label: 'Оголошення', icon: 'news' },
  { to: '/roll', label: 'Журнал', icon: 'roll' },
]

/** The rail of document screens and the mobile sheet: the same screens, grouped. */
export const NAV_GROUPS: readonly { title: string; items: readonly NavItem[] }[] = [
  {
    title: 'Ефір',
    items: [
      { to: '/', label: 'Ефір станції', icon: 'mast', end: true },
      { to: '/roll', label: 'Журнал виходу', icon: 'roll' },
    ],
  },
  {
    title: "Вихід на зв'язок",
    items: [{ to: '/contact', label: 'Заявка і доступ', icon: 'repo' }],
  },
  {
    title: 'Кабінет',
    items: [
      { to: '/inbox', label: 'Листи', icon: 'mail', count: 'unread' },
      { to: '/stages', label: 'Частини завдання', icon: 'parts', count: 'stages' },
      { to: '/news', label: 'Оголошення', icon: 'news' },
    ],
  },
]

/** Unread letters and parts not yet acknowledged, for the badges. */
export function useNavCounts(): Record<NavCount, number> {
  const summary = useCabinet()?.summary
  return {
    unread: summary?.unread ?? 0,
    stages: Math.max(0, (summary?.releasedStages ?? 0) - (summary?.acknowledgedStages ?? 0)),
  }
}
