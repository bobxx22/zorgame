import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { EtherPage } from '../pages/EtherPage'
import { Placeholder } from '../pages/Placeholder'
import { RollPage } from '../pages/RollPage'
import { EtherProvider } from './EtherProvider'
import { Layout } from './Layout'
import { ServerProvider } from './ServerProvider'

export function App() {
  return (
    <ServerProvider>
      <EtherProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<EtherPage />} />
              <Route
                path="register"
                element={
                  <Placeholder
                    title="Реєстрація"
                    items={[
                      'форма: логін, відображуване ім’я, пароль, репозиторій, мова',
                      'заготовка заявки й автонадсилання на відкритті просвіту',
                      'відновлення входом, якщо відповідь загубилася',
                    ]}
                  />
                }
              />
              <Route
                path="access"
                element={
                  <Placeholder
                    title="Доступ до репозиторію"
                    items={['кого запросити і що покласти в .zoria', 'статус, причина, час перевірки']}
                  />
                }
              />
              <Route path="inbox" element={<Placeholder title="Листи" items={['листи і сповіщення сервера']} />} />
              <Route path="news" element={<Placeholder title="Новини" items={['стрічка новин мережі']} />} />
              <Route
                path="stages"
                element={<Placeholder title="Частини завдання" items={['видані частини, уточнення, підтвердження']} />}
              />
              <Route path="roll" element={<RollPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </EtherProvider>
    </ServerProvider>
  )
}
