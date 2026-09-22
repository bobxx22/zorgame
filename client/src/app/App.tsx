import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { AccessPage } from '../pages/AccessPage'
import { EtherPage } from '../pages/EtherPage'
import { InboxPage } from '../pages/InboxPage'
import { NewsPage } from '../pages/NewsPage'
import { RegisterPage } from '../pages/RegisterPage'
import { RollPage } from '../pages/RollPage'
import { StagePage, StagesPage } from '../pages/StagesPage'
import { AuthProvider } from './AuthProvider'
import { CabinetProvider } from './CabinetProvider'
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
            <CabinetProvider>
              <BrowserRouter>
                <Routes>
                  <Route element={<Layout />}>
                    <Route index element={<EtherPage />} />
                    <Route path="register" element={<RegisterPage />} />
                    <Route path="access" element={<AccessPage />} />
                    <Route path="inbox" element={<InboxPage />} />
                    <Route path="news" element={<NewsPage />} />
                    <Route path="stages" element={<StagesPage />} />
                    <Route path="stages/:id" element={<StagePage />} />
                    <Route path="roll" element={<RollPage />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Route>
                </Routes>
              </BrowserRouter>
            </CabinetProvider>
          </RegistrationProvider>
        </AuthProvider>
      </EtherProvider>
    </ServerProvider>
  )
}
