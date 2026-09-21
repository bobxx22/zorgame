import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { Placeholder } from '../pages/Placeholder'
import { Layout } from './Layout'
import { ServerProvider } from './ServerProvider'

export function App() {
  return (
    <ServerProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route
              index
              element={
                <Placeholder
                  title="Ефір"
                  items={[
                    'фаза станції за перевіреним кадром: шум, просвіт, після просвіту',
                    'відлік провісника до відкриття просвіту',
                    'уривки листа Доглядача',
                  ]}
                />
              }
            />
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
            <Route
              path="roll"
              element={<Placeholder title="Журнал виходу на зв’язок" items={['номер, час, ім’я']} />}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ServerProvider>
  )
}
