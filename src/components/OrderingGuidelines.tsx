import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { BadgeCheck, Banknote, CalendarClock, PhoneCall, ReceiptText, Store, Truck } from 'lucide-react'
import { supabase, supabaseConfigured } from '@/lib/supabase'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'

/** Shown until the admin's version loads (and if it can't load). Admins edit these in Settings. */
export const DEFAULT_GUIDELINES = [
  'We deliver via Grab within Metro Manila from 12:00 PM to 6:00 PM.',
  'Pay by Cash on Delivery (COD) or online via GCash, MariBank or GoTyme.',
  'Orders are for booking (scheduled delivery) only. Same day delivery is not available.',
  'We will confirm your order by text or call.',
  'Menu prices are VAT inclusive and may vary or be subject to change by the merchant. Higher delivery fees may also apply for long distance deliveries.',
  'You can order from all merchants in the app and pay only one delivery fee.',
]

const ICONS = [Truck, Banknote, CalendarClock, PhoneCall, ReceiptText, Store]

export const useGuidelines = create<{ open: boolean; setOpen: (o: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}))

/**
 * Pops up every time the site is loaded or reloaded (any customer page).
 * Moving between pages inside the site doesn't re-open it.
 */
export function OrderingGuidelines() {
  const { open, setOpen } = useGuidelines()
  const [items, setItems] = useState<string[]>(DEFAULT_GUIDELINES)

  useEffect(() => {
    setOpen(true)
  }, [setOpen])

  useEffect(() => {
    if (!supabaseConfigured) return
    void supabase.rpc('get_checkout_info').then(({ data }) => {
      const list = (data as { ordering_guidelines?: unknown } | null)?.ordering_guidelines
      if (Array.isArray(list) && list.length && list.every((x) => typeof x === 'string')) setItems(list as string[])
    })
  }, [])

  const close = () => setOpen(false)

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      {/* Header and button stay put; only the list scrolls, so nothing is ever cut off on short screens. */}
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-md flex-col overflow-hidden p-0" hideClose>
        <div className="relative shrink-0 overflow-hidden bg-[#fdf3e3] px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
          <div className="pointer-events-none absolute -right-10 -top-10 size-36 rounded-full bg-[#f6dcae]" />
          <img src="/logo.png" alt="" className="relative mb-2 h-12 w-auto rounded-xl bg-white p-1 shadow-sm sm:h-14" />
          <DialogTitle className="relative pr-0 font-display text-2xl font-bold sm:text-[1.7rem]">Ordering Guidelines</DialogTitle>
          <DialogDescription className="relative text-navy/60">Please read before placing your order. Salamat po!</DialogDescription>
        </div>
        <ol className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 pb-7 pt-4 [mask-image:linear-gradient(to_bottom,black_calc(100%-1.75rem),transparent)] sm:px-6">
          {items.map((text, i) => {
            const Icon = ICONS[i] ?? BadgeCheck
            return (
              <li key={i} className="flex gap-3 animate-fade-up" style={{ animationDelay: `${i * 50}ms` }}>
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sand text-brand-600">
                  <Icon className="size-[18px]" strokeWidth={1.8} />
                </span>
                <p className="pt-2 text-sm leading-relaxed text-navy/80">
                  <span className="mr-1 font-heading font-semibold text-navy">{i + 1}.</span>
                  {text}
                </p>
              </li>
            )
          })}
        </ol>
        <div className="shrink-0 border-t border-sand bg-white px-5 py-4 sm:px-6">
          <Button size="lg" className="w-full" onClick={close} autoFocus>
            I understand, start ordering
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
