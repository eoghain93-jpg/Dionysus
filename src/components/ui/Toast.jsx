import { useToastStore } from '../../hooks/useToast'

const COLOURS = {
  error: 'bg-red-900 border-red-700',
  success: 'bg-emerald-900 border-emerald-700',
}

export default function Toast() {
  const { toasts, removeToast } = useToastStore()
  const toast = toasts[0]

  if (!toast) return null

  const colourClass = COLOURS[toast.type] ?? COLOURS.error

  return (
    <div className="fixed bottom-20 right-4 z-50 md:bottom-4">
      <button
        onClick={() => removeToast(toast.id)}
        className={`${colourClass} border text-white text-sm font-medium
          px-4 py-3 rounded-xl shadow-lg max-w-xs text-left cursor-pointer`}
        aria-live="polite"
      >
        {toast.message}
      </button>
    </div>
  )
}
