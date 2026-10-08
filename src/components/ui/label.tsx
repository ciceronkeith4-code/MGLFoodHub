import * as React from 'react'
import * as LabelPrimitive from '@radix-ui/react-label'
import { cn } from '@/lib/utils'

export function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root className={cn('text-sm font-semibold text-navy', className)} {...props} />
}

/** Label + control + hint/error, with accessible wiring. */
export function Field({
  label,
  htmlFor,
  required,
  optional,
  hint,
  error,
  children,
  className,
}: {
  label: React.ReactNode
  htmlFor?: string
  required?: boolean
  optional?: boolean
  hint?: React.ReactNode
  error?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('space-y-1.5', className)} data-field-error={error ? 'true' : undefined}>
      <Label htmlFor={htmlFor} className="block">
        {label}
        {required && <span className="ml-0.5 text-brand-red">*</span>}
        {optional && <span className="ml-1.5 text-xs font-normal text-navy/50">(optional)</span>}
      </Label>
      {children}
      {error ? (
        <p className="text-xs font-medium text-brand-red" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-navy/55">{hint}</p>
      ) : null}
    </div>
  )
}
