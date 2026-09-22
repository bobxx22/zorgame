import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { AccessPage } from '../pages/AccessPage'
import { EtherPage } from '../pages/EtherPage'
import { Placeholder } from '../pages/Placeholder'
import { RegisterPage } from '../pages/RegisterPage'
import { RollPage } from '../pages/RollPage'
import { AuthProvider } from './AuthProvider'
import { EtherProvider } from './EtherProvider'
import { Layout } from './Layout'
import { RegistrationProvider } from './RegistrationProvider'
import { ServerProvider } from './ServerProvider'

export function App() {
  return (
    <ServerProvider>
      <EtherProvider>
        <AuthProvider>
          <RegistrationProvider>
            <BrowserRouter>
              <Routes>
                <Route element={<Layout />}>
                  <Route index element={<EtherPage />} />
                  <Route path="register" element={<RegisterPage />} />
                  <Route path="access" element={<AccessPage />} />
                  <Route path="inbox" element={<Placeholder title="Листи" items={['листи і сповіщення сервера']} />} />
                  <Route path="news" element={<Placeholder title="Новини" items={['стрічка новин мережі']} />} />
                  <Route
                    path="stages"
                    element={
                      <Placeholder title="Частини завдання" items={['видані частини, уточнення, підтвердження']} />
                    }
                  />
                  <Route path="roll" element={<RollPage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Routes>
            </BrowserRouter>
          </RegistrationProvider>
        </AuthProvider>
      </EtherProvider>
    </ServerProvider>
  )
}
