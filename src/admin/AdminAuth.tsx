import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { Outlet } from 'react-router-dom'
import type { User } from '@supabase/supabase-js'
import { Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import NotFound from '@/pages/NotFound'

type Status = 'loading' | 'signed_out' | 'admin'

interface AdminAuth {
  status: Status
  user: User | null
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
}

const Ctx = createContext<AdminAuth | null>(null)

const normalizePath = (p: string) => '/' + p.replace(/^\/+|\/+$/g, '')
export const ADMIN_LOGIN_PATH = normalizePath((import.meta.env.VITE_ADMIN_PATH as string | undefined) || '/mgl-hub-admin-portal')

async function checkAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_admin')
  return !error && data === true
}

/** Wraps every admin route (login + /admin/*). Adds noindex and validates admin rights. */
export function AdminRoot() {
  const [status, setStatus] = useState<Status>('loading')
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    document.title = 'MGL Food Hub · Admin'
    return () => meta.remove()
  }, [])

  const evaluate = useCallback(async (u: User | null) => {
    if (!u) {
      setUser(null)
      setStatus('signed_out')
      return
    }
    if (await checkAdmin()) {
      setUser(u)
      setStatus('admin')
    } else {
      // Any non-admin who signs in is signed out immediately.
      await supabase.auth.signOut()
      setUser(null)
      setStatus('signed_out')
    }
  }, [])

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => evaluate(data.session?.user ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      // Defer: calling Supabase inside this callback can deadlock the client.
      if (event === 'SIGNED_OUT') setTimeout(() => void evaluate(null), 0)
      else if (event === 'SIGNED_IN') setTimeout(() => void evaluate(session?.user ?? null), 0)
    })
    return () => sub.subscription.unsubscribe()
  }, [evaluate])

  const signIn = useCallback<AdminAuth['signIn']>(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return error.message === 'Invalid login credentials' ? 'Incorrect email or password.' : error.message
    if (!(await checkAdmin())) {
      await supabase.auth.signOut()
      return 'This account does not have admin access.'
    }
    setUser(data.user)
    setStatus('admin')
    return null
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setUser(null)
    setStatus('signed_out')
  }, [])

  return (
    <Ctx.Provider value={{ status, user, signIn, signOut }}>
      <Outlet />
    </Ctx.Provider>
  )
}

export function useAdminAuth(): AdminAuth {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAdminAuth must be used inside AdminRoot')
  return ctx
}

export function FullScreenSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-cream">
      <Loader2 className="size-8 animate-spin text-brand" />
    </div>
  )
}

/** Protects /admin/*. Non-admins get the normal 404 so the admin area stays hidden. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { status } = useAdminAuth()
  if (status === 'loading') return <FullScreenSpinner />
  if (status !== 'admin') return <NotFound />
  return <>{children}</>
}
