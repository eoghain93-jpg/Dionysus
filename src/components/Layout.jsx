import { useEffect } from 'react'
import NavBar from './NavBar'
import StatusBar from './StatusBar'
import { initConnectivityListener } from '../lib/sync'
import { useSyncStore } from '../stores/syncStore'

export default function Layout({ children }) {
  const setOnline = useSyncStore(s => s.setOnline)

  useEffect(() => {
    setOnline(navigator.onLine)
    initConnectivityListener()
  }, [setOnline])

  return (
    <div className="flex min-h-screen bg-[#020617] flex-col">
      <StatusBar />
      <div className="flex flex-1 overflow-hidden">
        <NavBar />
        <main className="flex-1 overflow-auto pb-20 md:pb-0">
          {children}
        </main>
      </div>
    </div>
  )
}
