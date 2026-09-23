import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router'
import { ContactPage } from '../pages/ContactPage'
import { EtherPage } from '../pages/EtherPage'
import { InboxPage } from '../pages/InboxPage'
import { NewsPage } from '../pages/NewsPage'
import { RollPage } from '../pages/RollPage'
import { StagePage, StagesPage } from '../pages/StagesPage'
import { RadioProvider } from '../sound/RadioProvider'
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
    <RadioProvider>
      <ServerProvider>
        <EtherProvider>
          <AuthProvider>
            <RegistrationProvider>
              <CabinetProvider>
                <Router>
                  <Routes>
                    <Route element={<Layout />}>
                      <Route index element={<EtherPage />} />
                      <Route path="contact" element={<ContactPage />} />
                      {/* Registration and access became the steps of one page. */}
                      <Route path="register" element={<Navigate to="/contact" replace />} />
                      <Route path="access" element={<Navigate to="/contact" replace />} />
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
    </RadioProvider>
  )
}
