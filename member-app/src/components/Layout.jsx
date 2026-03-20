import BottomNav from './BottomNav'

export default function Layout({ children }) {
  return (
    <div className="min-h-screen bg-slate-900 pb-16">
      {children}
      <BottomNav />
    </div>
  )
}
