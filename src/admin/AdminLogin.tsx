import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { ErrorBanner } from '@/components/common'
import { Logo } from '@/components/Logo'
import { FullScreenSpinner, useAdminAuth } from './AdminAuth'

export default function AdminLogin() {
  const { status, signIn } = useAdminAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (status === 'loading') return <FullScreenSpinner />
  if (status === 'admin') return <Navigate to="/admin" replace />

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const err = await signIn(email.trim(), password)
    setBusy(false)
    if (err) setError(err)
    else navigate('/admin', { replace: true })
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-cream px-4">
      <div className="pointer-events-none absolute -right-32 top-0 h-full w-1/2 rounded-l-[45%] bg-[#f6dcae]/70" />
      <form onSubmit={submit} className="relative w-full max-w-sm space-y-5 rounded-[2rem] bg-white p-6 shadow-xl shadow-navy/10 ring-1 ring-sand-200/70 animate-pop sm:p-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo className="h-24" />
          <div>
            <h1 className="font-display text-3xl font-bold">Admin sign in</h1>
            <p className="text-sm text-navy/60">Authorized MGL Food Hub staff only.</p>
          </div>
        </div>
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {error && <ErrorBanner>{error}</ErrorBanner>}
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          <Lock /> Sign in
        </Button>
      </form>
    </div>
  )
}
