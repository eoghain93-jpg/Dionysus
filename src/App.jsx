import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import TillPage from './pages/TillPage'
import StockPage from './pages/StockPage'
import MembersPage from './pages/MembersPage'
import ReportsPage from './pages/ReportsPage'
import PromosPage from './pages/PromosPage'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<TillPage />} />
        <Route path="/stock" element={<StockPage />} />
        <Route path="/members" element={<MembersPage />} />
        <Route path="/promos" element={<PromosPage />} />
        <Route path="/reports" element={<ReportsPage />} />
      </Routes>
    </Layout>
  )
}
