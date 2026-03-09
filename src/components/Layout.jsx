import NavBar from './NavBar'

export default function Layout({ children }) {
  return (
    <div className="flex min-h-screen bg-[#020617] flex-col">
      <div className="flex flex-1 overflow-hidden">
        <NavBar />
        <main className="flex-1 overflow-auto pb-20 md:pb-0">
          {children}
        </main>
      </div>
    </div>
  )
}
