import { useState } from 'react'
import { Link } from 'react-router'
import { useCabinetStore } from '../app/cabinet-context'
import type { Message } from '../cabinet/schemas'
import { formatLocal } from '../lib/time'
import { accessStatusOf } from './auth-labels'
import { CabinetScreen } from './CabinetState'
import { Markdown } from './Markdown'

/** Letters with server notices; opening does not mark read, the button does (CL-29). */
export function InboxPage() {
  return (
    <CabinetScreen title="Листи">
      {(cabinet) =>
        cabinet.inbox === null ? (
          <p className="muted">Читаємо листи…</p>
        ) : cabinet.inbox.length === 0 ? (
          <p className="muted">Листів поки немає.</p>
        ) : (
          <div className="list">
            {cabinet.inbox.map((message) => (
              <Letter key={message.id} message={message} />
            ))}
          </div>
        )
      }
    </CabinetScreen>
  )
}

function Letter({ message }: { message: Message }) {
  const store = useCabinetStore()
  const [open, setOpen] = useState(false)
  const unread = message.readAt === null

  return (
    <article className={`panel letter-item ${unread ? 'unread' : ''}`}>
      <button
        type="button"
        className="letter-head"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open)
        }}
      >
        {unread && <span className="dot" aria-label="непрочитаний" />}
        <span className="letter-title">{message.title}</span>
        {message.kind === 'stage' && <span className="tag">частина завдання</span>}
        {message.notice && <span className="tag">{message.notice.type === 'repository' ? 'доступ' : 'сповіщення'}</span>}
        <span className="muted small mono">{formatLocal(message.createdAt)}</span>
      </button>
      {open && (
        <div className="letter-body">
          {message.notice?.type === 'repository' && (
            <p className="small">
              Статус заявки:{' '}
              <b>
                {accessStatusOf(message.notice.accessStatus ?? '')?.label ?? message.notice.accessStatus}
              </b>
              {message.notice.url && <span className="mono muted"> · {message.notice.url}</span>}
            </p>
          )}
          <Markdown source={message.body} />
          <div className="row">
            {message.stageId && <Link to={`/stages/${encodeURIComponent(message.stageId)}`}>Відкрити частину →</Link>}
            {unread ? (
              <button
                type="button"
                onClick={() => {
                  void store?.markRead(message.id)
                }}
              >
                Позначити прочитаним
              </button>
            ) : (
              <span className="muted small">прочитано {formatLocal(message.readAt)}</span>
            )}
          </div>
        </div>
      )}
    </article>
  )
}
