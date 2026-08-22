import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import { AppShell } from './components/AppShell'
import { SignIn } from './pages/auth/SignIn'
import { SignUp } from './pages/auth/SignUp'
import { Investigations } from './pages/Investigations'
import { InvestigationDetail } from './pages/InvestigationDetail'
import { Capture } from './pages/Capture'
import { People } from './pages/People'
import { PersonProfile } from './pages/PersonProfile'
import { Sources } from './pages/Sources'
import { SearchPage } from './pages/SearchPage'
import { Collections } from './pages/Collections'
import { ActivityPage } from './pages/ActivityPage'
import { Settings } from './pages/Settings'

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/signin" replace />
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/signin" element={<SignIn />} />
          <Route path="/signup" element={<SignUp />} />
          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route path="/" element={<Navigate to="/investigations" replace />} />
            <Route path="/investigations" element={<Investigations />} />
            <Route path="/investigations/:id" element={<InvestigationDetail />} />
            <Route path="/capture" element={<Capture />} />
            <Route path="/people" element={<People />} />
            <Route path="/people/:id" element={<PersonProfile />} />
            <Route path="/sources" element={<Sources />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/collections" element={<Collections />} />
            <Route path="/activity" element={<ActivityPage />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
