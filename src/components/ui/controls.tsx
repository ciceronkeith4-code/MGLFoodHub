import * as React from 'react'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import { Check, Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'peer size-5 shrink-0 rounded-md border-2 border-navy/30 bg-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 data-[state=checked]:border-brand data-[state=checked]:bg-brand aria-[invalid=true]:border-brand-red',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-white">
        <Check className="size-3.5" strokeWidth={3.5} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export function Switch({ className, size = 'md', ...props }: React.ComponentProps<typeof SwitchPrimitive.Root> & { size?: 'sm' | 'md' }) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border-2 border-transparent bg-navy/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-50 data-[state=checked]:bg-emerald-500',
        size === 'sm' ? 'h-5 w-9' : 'h-6 w-11',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'block rounded-full bg-white shadow transition-transform',
          size === 'sm' ? 'size-4 data-[state=checked]:translate-x-4' : 'size-5 data-[state=checked]:translate-x-5',
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export const RadioGroup = RadioGroupPrimitive.Root

/** Large tappable option card (payment methods, call results…). */
export function RadioCard({ className, children, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      className={cn(
        'group flex w-full items-center gap-3 rounded-2xl border-2 border-sand-200 bg-white p-3.5 text-left transition-all hover:border-brand/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 data-[state=checked]:border-brand data-[state=checked]:bg-brand-50',
        className,
      )}
      {...props}
    >
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-navy/30 group-data-[state=checked]:border-brand">
        <RadioGroupPrimitive.Indicator className="size-2.5 rounded-full bg-brand" />
      </span>
      {children}
    </RadioGroupPrimitive.Item>
  )
}

/** Pill toggle used for variants, options, categories and time slots. */
export const Chip = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }>(
  ({ className, selected, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-pressed={selected}
      className={cn(
        'inline-flex min-h-9 items-center justify-center gap-1 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-all active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45',
        selected
          ? 'border-transparent bg-brand text-navy shadow-sm shadow-brand/30'
          : 'border-sand-200 bg-white text-navy hover:border-brand hover:text-brand-600',
        className,
      )}
      {...props}
    />
  ),
)
Chip.displayName = 'Chip'

export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max = 99,
  disabled,
  size = 'md',
}: {
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
  disabled?: boolean
  size?: 'sm' | 'md'
}) {
  const btn = cn(
    'flex items-center justify-center rounded-full text-navy transition hover:bg-navy/5 active:scale-90 disabled:opacity-30',
    size === 'sm' ? 'size-8' : 'size-10',
  )
  return (
    <div className="inline-flex items-center rounded-full border border-sand-200 bg-white">
      <button type="button" className={btn} onClick={() => onChange(value - 1)} disabled={disabled || value <= min} aria-label="Decrease quantity">
        <Minus className="size-4" />
      </button>
      <span className={cn('min-w-7 text-center font-semibold tabular-nums', size === 'sm' && 'text-sm')} aria-live="polite">
        {value}
      </span>
      <button type="button" className={btn} onClick={() => onChange(value + 1)} disabled={disabled || value >= max} aria-label="Increase quantity">
        <Plus className="size-4" />
      </button>
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-xl bg-sand', className)} />
}
