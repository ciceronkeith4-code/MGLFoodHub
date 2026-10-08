import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, errorMessage } from '@/lib/supabase'
import type { PublicOrder } from '@/lib/types'

/**
 * Loads one order by its tracking token and keeps it live: the database pings
 * a channel named after the token whenever the order changes, and we re-read
 * it through get_order_by_token. Polling is a fallback for flaky connections.
 */
export function useTrackedOrder(token: string | undefined) {
  const [order, setOrder] = useState<PublicOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    const { data, error } = await supabase.rpc('get_order_by_token', { p_token: token })
    if (error) {
      setError(errorMessage(error))
    } else if (!data) {
      setNotFound(true)
    } else {
      const o = data as PublicOrder
      setOrder({
        ...o,
        subtotal: Number(o.subtotal),
        delivery_fee: Number(o.delivery_fee),
        total: Number(o.total),
        items: o.items.map((i) => ({ ...i, unit_price: Number(i.unit_price), line_total: Number(i.line_total) })),
      })
      setError(null)
    }
    setLoading(false)
  }, [token])

  useEffect(() => {
    if (!token) return
    void load()
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void load(), 300)
    }
    const channel = supabase.channel(`order:${token}`).on('broadcast', { event: 'order_updated' }, refresh).subscribe()
    const poll = setInterval(() => document.visibilityState === 'visible' && void load(), 45_000)
    const onVisible = () => document.visibilityState === 'visible' && void load()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      void supabase.removeChannel(channel)
      clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [token, load])

  return { order, loading, error, notFound, reload: load }
}
