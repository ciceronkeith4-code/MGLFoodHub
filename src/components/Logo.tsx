import { useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Uses the official logo at /public/logo.png. Until that file is added, a
 * vector version of the mark (navy MGL + orange→red food bag) is shown.
 */
export function Logo({
  className,
  light = false,
  showText = true,
  size = 'md',
}: {
  className?: string
  light?: boolean
  showText?: boolean
  size?: 'md' | 'lg'
}) {
  const lg = size === 'lg'
  const [failed, setFailed] = useState(false)
  if (!failed) {
    return (
      <img
        src="/logo.png"
        alt="MGL Food Hub"
        className={cn('h-10 w-auto object-contain', light && 'rounded-lg bg-white/95 p-1', className)}
        onError={() => setFailed(true)}
      />
    )
  }
  return (
    <span className={cn('inline-flex items-center', lg ? 'gap-4' : 'gap-2', className, 'h-auto')} aria-label="MGL Food Hub">
      <LogoMark className={cn('shrink-0', lg ? 'size-24' : 'size-9')} light={light} />
      {showText && (
        <span className={cn('flex flex-col leading-none', lg ? 'gap-2' : 'gap-1')}>
          <span className={cn('font-heading font-extrabold tracking-tight', lg ? 'text-6xl' : 'text-xl', light ? 'text-white' : 'text-navy')}>MGL</span>
          <span className={cn('text-brand-gradient font-heading font-bold tracking-[0.22em]', lg ? 'text-base' : 'text-[10px]')}>FOOD HUB</span>
        </span>
      )}
    </span>
  )
}

export function LogoMark({ className, light = false }: { className?: string; light?: boolean }) {
  const ink = light ? '#ffffff' : '#0D2B4E'
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="mgl-bag" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F7941D" />
          <stop offset="1" stopColor="#E2382B" />
        </linearGradient>
      </defs>
      <g stroke={ink} strokeLinecap="round" strokeWidth="2.6">
        <line x1="3" y1="23" x2="10" y2="23" />
        <line x1="5" y1="29" x2="11" y2="29" />
        <line x1="3" y1="35" x2="10" y2="35" />
      </g>
      <path d="M21 17v-3.5a6 6 0 0 1 12 0V17" fill="none" stroke={ink} strokeWidth="2.6" strokeLinecap="round" />
      <path d="M14 17h26l-2.2 24.2A3.2 3.2 0 0 1 34.6 44H19.4a3.2 3.2 0 0 1-3.2-2.8z" fill="url(#mgl-bag)" />
      <g fill="#fff">
        <ellipse cx="23.5" cy="25.5" rx="2.4" ry="3.3" />
        <rect x="22.7" y="27.5" width="1.6" height="11" rx="0.8" />
        <rect x="29.4" y="31" width="1.6" height="7.5" rx="0.8" />
        <path d="M27.6 22.2v5.6a2.6 2.6 0 0 0 5.2 0v-5.6h-1.1v4.6h-0.9v-4.6h-1.2v4.6h-0.9v-4.6z" />
      </g>
    </svg>
  )
}
