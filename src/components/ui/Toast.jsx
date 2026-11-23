import { useToastStore } from '../../hooks/useToast'

const COLOURS = {
  error: 'bg-red-950 border-red-900 text-red-100',
  success: 'bg-emerald-950 border-emerald-900 text-emerald-100',
}

export default function Toast() {
  const { toasts, removeToast } = useToastStore()
  const toast = toasts[0]

  if (!toast) return null

  const colourClass = COLOURS[toast.type] ?? COLOURS.error

  return (
    <div className="fixed bottom-20 right-4 left-4 z-50 flex justify-end md:left-auto md:bottom-4">
      <button
        onClick={() => removeToast(toast.id)}
        className={`${colourClass} border text-base font-bold leading-snug
          min-h-[56px] px-5 py-3 rounded-2xl shadow-lg shadow-black/40 max-w-sm text-left cursor-pointer`}
        aria-live="polite"
      >
        {toast.message}
      </button>
    </div>
  )
}
