import { Link } from 'react-router'
import type { ServerId } from '../config/servers'
import { zoneLabel } from '../lib/time'
import { Mark } from '../ui/Mark'
import { Seg } from '../ui/Seg'
import { useEther } from './ether-context'
import { useServer } from './server-context'

const SERVER_SHORT: Record<ServerId, string> = {
  prod: 'Мережа',
  stand: 'Стенд',
  custom: 'Локальний',
}

/** The site's footer: the mark, the time zone note, and here the server switch (CL-40). */
export function Foot() {
  const { server, servers, selectServer } = useServer()
  const { listening } = useEther()

  return (
    <footer className="foot">
      <div className="wrap">
        <Link className="brand" to="/">
          <Mark />
          <span className="wm">ЗОРЯ</span>
        </Link>
        <div>
          <p className="tz-note">
            Час показано у вашій зоні: {zoneLabel()}. Сервер мережі живе в UTC; відлік іде за його годинником.
          </p>
          <div className="foot-srv">
            <span>Сервер</span>
            <Seg
              label="Сервер"
              options={servers.map((s) => ({ value: s.id, label: SERVER_SHORT[s.id] }))}
              value={server.id}
              onChange={selectServer}
            />
            <code>{server.apiBase}</code>
          </div>
          <p>
            Клієнт слухає ефір не частіше ніж раз на 15 секунд{listening ? '' : ' (зараз на паузі)'} і вірить лише кадрам
            із печаткою станції. Клавіша M вмикає і вимикає звук.
          </p>
        </div>
      </div>
    </footer>
  )
}
