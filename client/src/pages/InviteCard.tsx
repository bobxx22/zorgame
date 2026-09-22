import { useConfig } from '../app/use-config'
import { ORGANIZER_GITHUB } from '../config/season'
import { parseRepository } from '../auth/validate'
import { CopyButton } from './CopyButton'

interface InviteCardProps {
  username: string
  repositoryUrl: string | null
}

/** Whom to invite, with which permission, and what goes into .zoria (CL-19, CL-23). */
export function InviteCard({ username, repositoryUrl }: InviteCardProps) {
  const config = useConfig()
  const access = config.status === 'ready' ? config.config.repositoryAccess : null
  const githubUsername = access?.githubUsername ?? ORGANIZER_GITHUB
  const repo = repositoryUrl ? parseRepository(repositoryUrl) : null
  const settingsUrl = repo?.ok ? `${repo.url}/settings/access` : null
  const command = `echo ${username} > .zoria && git add .zoria && git commit -m "Зоря.нет: логін у мережі" && git push`

  return (
    <div className="invite">
      <h2>Що зробити з репозиторієм</h2>
      <ol className="steps">
        <li>
          Запросіть до репозиторію GitHub-акаунт <b className="mono">{githubUsername}</b>
          <CopyButton text={githubUsername} />
          {config.status !== 'ready' && (
            <span className="muted small"> (з ТЗ; сервер ще не підтвердив)</span>
          )}
          {access && <div className="muted small">Право: {access.permission}</div>}
          {settingsUrl && (
            <div className="small">
              <a href={settingsUrl} target="_blank" rel="noopener noreferrer">
                Налаштування доступу репозиторію
              </a>
            </div>
          )}
        </li>
        <li>
          Покладіть у корінь гілки за замовчуванням файл <b className="mono">.zoria</b> з вашим логіном у мережі:{' '}
          <b className="mono">{username}</b>
          <pre className="code mono">{command}</pre>
          <CopyButton text={command} label="Копіювати команду" />
        </li>
        <li>Бот перевіряє заявку сам: після запрошення, після зміни заявки і раз на 10 хвилин.</li>
      </ol>
      {access?.instructions && <p className="muted small">{access.instructions}</p>}
    </div>
  )
}
