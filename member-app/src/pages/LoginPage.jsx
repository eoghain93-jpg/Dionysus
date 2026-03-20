import { Link } from 'react-router-dom'

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
      <div className="bg-slate-800 rounded-2xl p-8 max-w-sm w-full text-center">
        <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-6">
          <span className="text-2xl">🎫</span>
        </div>
        <h1 className="text-white text-2xl font-bold mb-3">Fairmile</h1>
        <p className="text-slate-400 text-sm leading-relaxed">
          Check your email for your membership invite link. Tap it to access your digital card and tab.
        </p>
        <p className="text-slate-500 text-xs mt-6">
          Not a member yet?{' '}
          <Link to="/join" className="text-blue-400 hover:text-blue-300 underline">
            Join for £50
          </Link>
        </p>
      </div>
    </div>
  )
}
