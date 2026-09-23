import type { News } from '../cabinet/schemas'
import { cls } from '../lib/cls'
import { formatDate, formatDay, formatLocal } from '../lib/time'
import { Icon } from '../ui/Icon'
import { Toc } from '../ui/Toc'
import { CabinetDoc } from './CabinetDoc'
import { Markdown } from './Markdown'

const entryId = (item: News) => `n-${item.id}`

/** The network's announcements, the same page as the site's /news. */
export function NewsPage() {
  return (
    <CabinetDoc
      here="Оголошення"
      title="Оголошення"
      lead="Оперативна стрічка мережі: що змінилося в правилах і що робити просто зараз. Найсвіжіше - згори."
      meta={(cabinet) =>
        cabinet.summary?.latestNews ? (
          <span>
            <Icon name="calendar" />
            останнє {formatDay(cabinet.summary.latestNews)}
          </span>
        ) : null
      }
      toc={(cabinet) =>
        cabinet.news && cabinet.news.length > 0 ? (
          <Toc
            items={cabinet.news.map((item) => ({
              id: entryId(item),
              n: formatDate(item.publishedAt),
              stacked: true,
              label: item.title,
              dim: item.archivedAt !== null,
            }))}
          />
        ) : null
      }
    >
      {(cabinet) =>
        cabinet.news === null ? (
          <p className="note">Читаємо оголошення…</p>
        ) : cabinet.news.length === 0 ? (
          <p className="note">Оголошень поки немає.</p>
        ) : (
          cabinet.news.map((item) => (
            <section key={item.id} className={cls('entry', item.archivedAt && 'archived')}>
              <h2 id={entryId(item)}>
                <span className="hn num">{formatDate(item.publishedAt)}</span>
                {item.title}
              </h2>
              {(item.updatedAt !== item.createdAt || item.archivedAt) && (
                <p className="entry-tags">
                  {item.updatedAt !== item.createdAt && (
                    <span className="tag">виправлено {formatLocal(item.updatedAt)}</span>
                  )}
                  {item.archivedAt && <span className="tag">знято зі стрічки {formatLocal(item.archivedAt)}</span>}
                </p>
              )}
              <Markdown source={item.body} />
            </section>
          ))
        )
      }
    </CabinetDoc>
  )
}
