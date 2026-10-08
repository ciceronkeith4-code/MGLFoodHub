import * as React from 'react'
import { cn } from '@/lib/utils'

export const fieldClass =
  'w-full rounded-xl border border-sand-200 bg-white px-3.5 text-[16px] text-navy placeholder:text-navy/40 shadow-sm transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 disabled:opacity-60 aria-[invalid=true]:border-brand-red aria-[invalid=true]:ring-brand-red/20'

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn(fieldClass, 'h-11', className)} {...props} />,
)
Input.displayName = 'Input'

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => <textarea ref={ref} className={cn(fieldClass, 'min-h-20 py-2.5', className)} {...props} />,
)
Textarea.displayName = 'Textarea'

const chevron =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%230D2B4E' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")"

export const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, style, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(fieldClass, 'h-11 appearance-none bg-[length:16px] bg-[right_12px_center] bg-no-repeat pr-9', className)}
      style={{ backgroundImage: chevron, ...style }}
      {...props}
    />
  ),
)
NativeSelect.displayName = 'NativeSelect'
