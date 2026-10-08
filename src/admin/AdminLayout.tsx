import { createContext, Suspense, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  BarChart3, ClipboardList, LayoutDashboard, LogOut, Menu, Package, ScrollText, Settings, Volume2, VolumeX, X,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { OrderRow } from '@/lib/types'
import { cn, peso, storage } from '@/lib/utils'
import { Logo } from '@/components/Logo'
import { useAdminAuth } from './AdminAuth'

interface AdminLive {
  /** Increments on every order change — pages add it to their effect deps to refresh. */
  version: number
  unseen: number
  clearUnseen: () => void
}
const LiveCtx = createContext<AdminLive>({ version: 0, unseen: 0, clearUnseen: () => {} })
export const useAdminLive = () => useContext(LiveCtx)

// --- New-order chime (Web Audio; no asset needed) -------------------------
let audioCtx: AudioContext | null = null
function unlockAudio() {
  try {
    audioCtx ??= new AudioContext()
    if (audioCtx.state === 'suspended') void audioCtx.resume()
  } catch {
    /* no audio */
  }
}
function chime() {
  if (!audioCtx) return
  const t = audioCtx.currentTime
  ;[784, 1047, 1319].forEach((freq, i) => {
    const osc = audioCtx!.createOscillator()
    const gain = audioCtx!.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, t + i * 0.16)
    gain.gain.exponentialRampToValueAtTime(0.35, t + i * 0.16 + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.4)
    osc.connect(gain).connect(audioCtx!.destination)
    osc.start(t + i * 0.16)
    osc.stop(t + i * 0.16 + 0.45)
  })
}

const NAV = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/orders', label: 'Orders', icon: ClipboardList },
  { to: '/admin/prep-list', label: 'Prep List', icon: ScrollText },
  { to: '/admin/products', label: 'Products & Stores', icon: Package },
  { to: '/admin/reports', label: 'Reports', icon: BarChart3 },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
]

export default function AdminLayout() {
  const { user, signOut } = useAdminAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [version, setVersion] = useState(0)
  const [unseen, setUnseen] = useState(0)
  const [sound, setSound] = useState(() => storage.get('mgl_admin_sound', true))
  const [menuOpen, setMenuOpen] = useState(false)
  const soundRef = useRef(sound)
  soundRef.current = sound

  const clearUnseen = useCallback(() => setUnseen(0), [])

  useEffect(() => {
    const unlock = () => unlockAudio()
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  useEffect(() => {
    const channel = supabase
      .channel('admin-orders-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
        setVersion((v) => v + 1)
        if (payload.eventType === 'INSERT') {
          const o = payload.new as OrderRow
          setUnseen((n) => n + 1)
          if (soundRef.current) chime()
          toast.success(`New order ${o.order_number}`, {
            description: `${o.customer_name} · ${o.payment_method === 'gcash' ? 'GCash' : 'COD'} · ${peso(o.subtotal)}`,
            action: { label: 'Open', onClick: () => navigate(`/admin/orders/${o.id}`) },
            duration: 10_000,
          })
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'order_status_history' }, (payload) => {
        setVersion((v) => v + 1)
        const h = payload.new as { status: string; order_id: string; note: string | null }
        if (h.status === 'cancel_requested') {
          if (soundRef.current) chime()
          toast.warning('A customer requested a cancellation', {
            description: h.note ?? undefined,
            action: { label: 'Open', onClick: () => navigate(`/admin/orders/${h.order_id}`) },
            duration: 10_000,
          })
        } else if (h.status === 'proof_resubmitted') {
          toast.info('A customer re-uploaded a GCash payment proof', {
            action: { label: 'Open', onClick: () => navigate(`/admin/orders/${h.order_id}`) },
          })
        }
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [navigate])

  useEffect(() => {
    document.title = unseen ? `(${unseen}) New order · MGL Admin` : 'MGL Food Hub · Admin'
  }, [unseen])

  useEffect(() => setMenuOpen(false), [pathname])

  const nav = (
    <nav className="flex flex-col gap-1">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={() => to === '/admin/orders' && clearUnseen()}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-full px-4 py-2.5 text-sm font-semibold transition-colors',
              isActive ? 'bg-brand text-navy shadow-sm shadow-brand/30' : 'text-navy/70 hover:bg-sand hover:text-navy',
            )
          }
        >
          <Icon className="size-5" />
          <span className="flex-1">{label}</span>
          {to === '/admin/orders' && unseen > 0 && (
            <span className="flex min-w-6 items-center justify-center rounded-full bg-brand-red px-1.5 py-0.5 text-xs font-bold text-white animate-pop">
              {unseen}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  )

  const footer = (
    <div className="space-y-1 border-t border-sand pt-4 text-sm text-navy/70">
      <button
        type="button"
        onClick={() => {
          setSound((s) => {
            storage.set('mgl_admin_sound', !s)
            return !s
          })
          unlockAudio()
        }}
        className="flex w-full items-center gap-2 rounded-full px-4 py-2 hover:bg-sand"
      >
        {sound ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
        New-order sound {sound ? 'on' : 'off'}
      </button>
      <p className="truncate px-4 text-xs text-navy/50">{user?.email}</p>
      <button type="button" onClick={() => void signOut()} className="flex w-full items-center gap-2 rounded-full px-4 py-2 hover:bg-sand">
        <LogOut className="size-4" /> Sign out
      </button>
    </div>
  )

  return (
    <LiveCtx.Provider value={{ version, unseen, clearUnseen }}>
      <div className="min-h-dvh bg-cream lg:pl-64">
        {/* Desktop sidebar */}
        <aside className="no-print fixed inset-y-0 left-0 hidden w-64 flex-col gap-6 border-r border-sand-200/70 bg-white p-4 lg:flex">
          <div className="px-2 pt-1">
            <Logo className="h-14" />
            <p className="mt-1 font-script text-xl text-brand-600">Admin</p>
          </div>
          <div className="flex-1">{nav}</div>
          {footer}
        </aside>

        {/* Mobile top bar */}
        <header className="no-print sticky top-0 z-40 flex h-16 items-center justify-between border-b border-sand-200/70 bg-white px-3 text-navy lg:hidden">
          <button type="button" onClick={() => setMenuOpen(true)} className="relative rounded-full p-2 hover:bg-sand" aria-label="Open menu">
            <Menu className="size-6" />
            {unseen > 0 && <span className="absolute right-1 top-1 size-2.5 rounded-full bg-brand" />}
          </button>
          <span className="flex items-center gap-2"><Logo className="h-10" /><span className="font-script text-xl text-brand-600">Admin</span></span>
          <span className="w-10" />
        </header>
        {menuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-navy/40 backdrop-blur-[2px]" onClick={() => setMenuOpen(false)} />
            <aside className="absolute inset-y-0 left-0 flex w-[min(18rem,85vw)] flex-col gap-6 overflow-y-auto bg-white p-4 shadow-2xl animate-fade-up">
              <div className="flex items-center justify-between">
                <Logo className="h-11" />
                <button type="button" onClick={() => setMenuOpen(false)} className="rounded-full p-2 text-navy hover:bg-sand" aria-label="Close menu">
                  <X className="size-5" />
                </button>
              </div>
              <div className="flex-1">{nav}</div>
              {footer}
            </aside>
          </div>
        )}

        <main className="mx-auto max-w-7xl p-3 sm:p-6 lg:p-8">
          <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-white/70" />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </LiveCtx.Provider>
  )
}
