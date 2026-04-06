import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import TillPage from './pages/TillPage'
import StockPage from './pages/StockPage'
import MembersPage from './pages/MembersPage'
import ReportsPage from './pages/ReportsPage'
import PromosPage from './pages/PromosPage'
import TabsPage from './pages/TabsPage'
import SettingsPage from './pages/SettingsPage'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<TillPage />} />
        <Route path="/stock" element={<StockPage />} />
        <Route path="/members" element={<MembersPage />} />
        <Route path="/tabs" element={<TabsPage />} />
        <Route path="/promos" element={<PromosPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </Layout>
  )
}
