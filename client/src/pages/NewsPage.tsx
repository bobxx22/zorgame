import { formatLocal } from '../lib/time'
import { CabinetScreen } from './CabinetState'
import { Markdown } from './Markdown'

export function NewsPage() {
  return (
    <CabinetScreen title="Новини">
      {(cabinet) =>
        cabinet.news === null ? (
          <p className="muted">Читаємо новини…</p>
        ) : cabinet.news.length === 0 ? (
          <p className="muted">Новин поки немає.</p>
        ) : (
          <div className="list">
            {cabinet.news.map((item) => (
              <article key={item.id} className={`panel ${item.archivedAt ? 'archived' : ''}`}>
                <div className="screen-head">
                  <h2>{item.title}</h2>
                  <span className="muted small mono">{formatLocal(item.publishedAt)}</span>
                </div>
                {item.updatedAt !== item.createdAt && (
                  <p className="muted small">виправлено {formatLocal(item.updatedAt)}</p>
                )}
                {item.archivedAt && <p className="muted small">знято зі стрічки {formatLocal(item.archivedAt)}</p>}
                <Markdown source={item.body} />
              </article>
            ))}
          </div>
        )
      }
    </CabinetScreen>
  )
}
