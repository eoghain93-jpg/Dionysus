import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import AuthCallbackPage from './pages/AuthCallbackPage'
import MyCardPage from './pages/MyCardPage'
import MyTabPage from './pages/MyTabPage'
import HistoryPage from './pages/HistoryPage'
import AccountPage from './pages/AccountPage'
import JoinPage from './pages/JoinPage'

export default function App() {
  const { session, loading, init } = useAuthStore()

  useEffect(() => {
    let subscription
    init().then((sub) => { subscription = sub })
    return () => subscription?.unsubscribe()
  }, [init])

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <p className="text-slate-400">Loading…</p>
      </div>
    )
  }

  if (!session) {
    return (
      <Routes>
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/join" element={<JoinPage />} />
        <Route path="*" element={<LoginPage />} />
      </Routes>
    )
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<MyCardPage />} />
        <Route path="/tab" element={<MyTabPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
