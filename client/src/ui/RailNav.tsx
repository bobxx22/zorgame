import { NavLink } from 'react-router'
import { cls } from '../lib/cls'
import { Icon } from './Icon'
import { NAV_GROUPS, useNavCounts } from './nav'

/** Grouped screen list: the left rail of a document, and the mobile sheet. */
export function RailNav({ onNavigate }: { onNavigate?: () => void }) {
  const counts = useNavCounts()
  return (
    <>
      {NAV_GROUPS.map((group) => (
        <div key={group.title} className="rgroup">
          <p className="rh">{group.title}</p>
          <ul className="pk">
            {group.items.map((item) => {
              const count = item.count ? counts[item.count] : 0
              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end ?? false}
                    className={({ isActive }) => cls(isActive && 'on')}
                    onClick={onNavigate}
                  >
                    <Icon name={item.icon} />
                    <span className="pl">{item.label}</span>
                    {count > 0 && <span className="cnt num">{count}</span>}
                  </NavLink>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </>
  )
}
