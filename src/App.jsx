import { Routes, Route } from 'react-router-dom'
import DeviceGate from './components/device/DeviceGate'
import Layout from './components/Layout'
import TillPage from './pages/TillPage'
import StockPage from './pages/StockPage'
import MembersPage from './pages/MembersPage'
import ReportsPage from './pages/ReportsPage'
import PromosPage from './pages/PromosPage'
import TabsPage from './pages/TabsPage'
import SettingsPage from './pages/SettingsPage'
import StocktakePage from './pages/StocktakePage'
import CountPage from './pages/CountPage'
import MonthlyReportPage from './pages/MonthlyReportPage'

export default function App() {
  return (
    <DeviceGate>
      <Layout>
        <Routes>
          <Route path="/" element={<TillPage />} />
          <Route path="/stock" element={<StockPage />} />
          <Route path="/members" element={<MembersPage />} />
          <Route path="/tabs" element={<TabsPage />} />
          <Route path="/promos" element={<PromosPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/stocktake" element={<StocktakePage />} />
          <Route path="/count" element={<CountPage />} />
          <Route path="/monthly-report" element={<MonthlyReportPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </Layout>
    </DeviceGate>
  )
}
