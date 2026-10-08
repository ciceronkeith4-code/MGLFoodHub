import { useState, type ReactNode } from 'react'
import { AlertTriangle, Info, Utensils, ZoomIn, ZoomOut } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { Badge } from './ui/badge'
import type { Tone } from '@/lib/orderStatus'

export const DELIVERY_DISCLAIMER =
  'Menu prices are VAT inclusive and may vary or be subject to change by the merchant. Higher delivery fees may also apply for long distance deliveries. For long distance deliveries, please be reminded that the quality of some food items may not be the same as in store quality.'

export function Disclaimer({ className }: { className?: string }) {
  return (
    <div className={cn('flex gap-3 rounded-2xl bg-[#fdf3e3] p-4 text-sm text-navy/75 ring-1 ring-sand-200', className)}>
      <Info className="mt-0.5 size-5 shrink-0 text-brand-600" />
      <p>{DELIVERY_DISCLAIMER}</p>
    </div>
  )
}

export function ScheduledNotice({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center justify-center gap-2 bg-navy px-4 py-2 text-center text-xs font-medium text-white sm:text-sm', className)}>
      <span aria-hidden>🗓️</span>
      <span>
        All orders are <strong className="text-brand">scheduled</strong>. Same day delivery is not available.
      </span>
    </div>
  )
}

/** Image with a branded fallback when the file is missing. */
export function SmartImage({
  src,
  alt,
  className,
  fallbackLabel,
}: {
  src: string | null | undefined
  alt: string
  className?: string
  fallbackLabel?: string
}) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-1 bg-gradient-to-br from-[#f6dcae] via-[#fdf3e3] to-white text-brand-600',
          className,
        )}
        role="img"
        aria-label={alt}
      >
        <Utensils className="size-7 opacity-70" />
        {fallbackLabel && <span className="px-3 text-center font-heading text-sm font-bold text-navy/70">{fallbackLabel}</span>}
      </div>
    )
  }
  return <img src={src} alt={alt} loading="lazy" decoding="async" className={cn('object-cover', className)} onError={() => setFailed(true)} />
}

/** Full-screen image viewer with tap-to-zoom (pinch zoom also works on phones). */
export function Lightbox({
  open,
  onOpenChange,
  src,
  title,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  src: string | null
  title: string
}) {
  const [zoom, setZoom] = useState(false)
  const [failed, setFailed] = useState(false)
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) setZoom(false)
      }}
    >
      <DialogContent className="flex h-[92dvh] max-w-4xl flex-col bg-navy p-3 text-white sm:p-4">
        <div className="flex min-w-0 items-center justify-between gap-2 pr-10">
          <DialogTitle className="min-w-0 truncate pr-0 text-white">{title}</DialogTitle>
          {!failed && src && (
            <button
              type="button"
              onClick={() => setZoom((z) => !z)}
              className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20"
            >
              {zoom ? <ZoomOut className="size-4" /> : <ZoomIn className="size-4" />}
              {zoom ? 'Fit' : 'Zoom'}
            </button>
          )}
        </div>
        <div className="mt-3 flex-1 overflow-auto rounded-xl bg-black/30" style={{ touchAction: 'pinch-zoom pan-x pan-y' }}>
          {src && !failed ? (
            <img
              src={src}
              alt={title}
              onError={() => setFailed(true)}
              onClick={() => setZoom((z) => !z)}
              className={cn(
                'mx-auto transition-[width] duration-200',
                zoom ? 'w-[250%] max-w-none cursor-zoom-out sm:w-[180%]' : 'h-full w-full cursor-zoom-in object-contain',
              )}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-white/70">
              <Utensils className="size-8" />
              <p>The menu photo isn't available yet.</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: ReactNode
  title: string
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-6 py-12 text-center animate-fade-up', className)}>
      {icon && <div className="flex size-20 items-center justify-center rounded-full bg-sand text-brand-600 [&_svg]:size-9">{icon}</div>}
      <h3 className="font-display text-2xl font-bold">{title}</h3>
      {children && <div className="max-w-sm text-sm text-navy/65">{children}</div>}
      {action}
    </div>
  )
}

export function ErrorBanner({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="alert" className={cn('flex gap-3 rounded-2xl border border-brand-red/30 bg-red-50 p-4 text-sm text-red-800', className)}>
      <AlertTriangle className="mt-0.5 size-5 shrink-0" />
      <div>{children}</div>
    </div>
  )
}

export function ToneBadge({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <Badge tone={tone} className={className}>
      {children}
    </Badge>
  )
}

export const BADGE_LABEL: Record<string, string> = {
  best_seller: '🔥 Best Seller',
  new: '✨ New',
  all_time_favorite: '❤️ All Time Favorite',
}

export function ProductBadge({ badge }: { badge: string | null }) {
  if (!badge) return null
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide',
        badge === 'best_seller' && 'bg-brand-gradient text-white',
        badge === 'new' && 'bg-emerald-500 text-white',
        badge === 'all_time_favorite' && 'bg-navy text-white',
      )}
    >
      {BADGE_LABEL[badge] ?? badge}
    </span>
  )
}
