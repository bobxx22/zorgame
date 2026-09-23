import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router'
import { cls } from '../lib/cls'
import { RailNav } from './RailNav'

export interface Crumb {
  to: string
  label: string
}

interface DocPageProps {
  crumbs: readonly Crumb[]
  /** The last crumb: this page, not a link. */
  here: string
  title: ReactNode
  lead?: ReactNode
  meta?: ReactNode
  /** Right rail: the table of contents or the page's own panel. */
  toc?: ReactNode
  /** The text column takes the place of the right rail too. */
  wide?: boolean
  children: ReactNode
}

/**
 * A screen laid out as one of the site's documents: the rail of screens on the
 * left, the text column of 790 px, the page's contents on the right.
 */
export function DocPage({ crumbs, here, title, lead, meta, toc, wide = false, children }: DocPageProps) {
  return (
    <div className={cls('docgrid', !toc && 'no-toc', wide && 'wide')}>
      <aside className="rail l" aria-label="Екрани клієнта">
        <RailNav />
      </aside>
      <div className="main">
        <article className="doc">
          <nav className="crumb" aria-label="Шлях">
            {crumbs.map((crumb) => (
              <Fragment key={crumb.to}>
                <Link to={crumb.to}>{crumb.label}</Link>
                <span aria-hidden="true">/</span>
              </Fragment>
            ))}
            <span>{here}</span>
          </nav>
          <h1>{title}</h1>
          {lead && <p className="lead">{lead}</p>}
          {meta && <div className="meta-row">{meta}</div>}
          {children}
        </article>
      </div>
      {toc && (
        <aside className="rail r" aria-label="На цій сторінці">
          {toc}
        </aside>
      )}
    </div>
  )
}
