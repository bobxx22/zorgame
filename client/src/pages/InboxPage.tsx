import { Link } from 'react-router'
import { useCabinetStore } from '../app/cabinet-context'
import type { Message } from '../cabinet/schemas'
import { cls } from '../lib/cls'
import { formatDate, formatLocal } from '../lib/time'
import { Icon } from '../ui/Icon'
import { Toc } from '../ui/Toc'
import { accessStatusOf } from './auth-labels'
import { CabinetDoc } from './CabinetDoc'
import { Markdown } from './Markdown'

const entryId = (message: Message) => `m-${message.id}`

/** Letters laid out as the site's announcements; the button marks read, reading does not (CL-29). */
export function InboxPage() {
  return (
    <CabinetDoc
      here="Листи"
      title="Листи"
      lead="Особисті листи й сповіщення сервера, найсвіжіші згори. Прочитання не рахується саме: під кожним листом є кнопка."
      meta={(cabinet) => (
        <span>
          <Icon name="mail" />
          непрочитаних: {cabinet.summary?.unread ?? 0}
        </span>
      )}
      toc={(cabinet) =>
        cabinet.inbox && cabinet.inbox.length > 0 ? (
          <Toc
            title="Листи"
            items={cabinet.inbox.map((message) => ({
              id: entryId(message),
              n: formatDate(message.createdAt),
              stacked: true,
              label: message.title,
              dim: message.readAt !== null,
            }))}
          />
        ) : null
      }
    >
      {(cabinet) =>
        cabinet.inbox === null ? (
          <p className="note">Читаємо листи…</p>
        ) : cabinet.inbox.length === 0 ? (
          <p className="note">Листів поки немає.</p>
        ) : (
          cabinet.inbox.map((message) => <Letter key={message.id} message={message} />)
        )
      }
    </CabinetDoc>
  )
}

function Letter({ message }: { message: Message }) {
  const store = useCabinetStore()
  const unread = message.readAt === null
  const notice = message.notice

  return (
    <section className={cls('entry', unread && 'unread')}>
      <h2 id={entryId(message)}>
        <span className="hn num">{formatDate(message.createdAt)}</span>
        {message.title}
      </h2>
      <p className="entry-tags">
        {unread && (
          <span className="tag new">
            <i className="lamp" />
            непрочитаний
          </span>
        )}
        {message.kind === 'stage' && <span className="tag">частина завдання</span>}
        {notice && <span className="tag">{notice.type === 'repository' ? 'доступ до репозиторію' : 'сповіщення'}</span>}
        <span className="num">{formatLocal(message.createdAt)}</span>
      </p>
      {notice?.type === 'repository' && (
        <p className="callout">
          Статус заявки: <b>{accessStatusOf(notice.accessStatus ?? '')?.label ?? notice.accessStatus}</b>
          {notice.url && (
            <>
              {' '}
              · <code>{notice.url}</code>
            </>
          )}
        </p>
      )}
      <Markdown source={message.body} />
      <div className="entry-foot">
        {message.stageId && (
          <Link className="btn sm" to={`/stages/${encodeURIComponent(message.stageId)}`}>
            <Icon name="parts" />
            Відкрити частину
          </Link>
        )}
        {unread ? (
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              void store?.markRead(message.id)
            }}
          >
            <Icon name="check" />
            Позначити прочитаним
          </button>
        ) : (
          <span className="note-inline num">прочитано {formatLocal(message.readAt)}</span>
        )}
      </div>
    </section>
  )
}
