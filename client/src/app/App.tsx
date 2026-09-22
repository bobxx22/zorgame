import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router'
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

/**
 * Opened from disk (file://), the History API is not allowed: the single-file
 * build routes by hash instead (part 3 requirement P3-03).
 */
const Router = typeof window !== 'undefined' && window.location.protocol === 'file:' ? HashRouter : BrowserRouter

export function App() {
  return (
    <ServerProvider>
      <EtherProvider>
        <AuthProvider>
          <RegistrationProvider>
            <CabinetProvider>
              <Router>
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
              </Router>
            </CabinetProvider>
          </RegistrationProvider>
        </AuthProvider>
      </EtherProvider>
    </ServerProvider>
  )
}
