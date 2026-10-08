import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex min-w-0 max-w-full items-center justify-center gap-2 text-center leading-tight rounded-full font-semibold transition-all duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-brand text-navy shadow-sm shadow-brand/30 hover:bg-[#f9a23a] hover:shadow-md hover:shadow-brand/30',
        navy: 'bg-navy text-white hover:bg-navy-800',
        outline: 'border border-navy/15 bg-white text-navy hover:border-brand hover:text-brand-600',
        ghost: 'text-navy hover:bg-navy/5',
        soft: 'bg-brand-50 text-brand-600 hover:bg-brand-100',
        destructive: 'bg-brand-red text-white hover:bg-brand-red/90',
        link: 'text-brand-600 underline-offset-4 hover:underline rounded-none px-0 active:scale-100',
      },
      size: {
        sm: 'min-h-9 px-3.5 py-1.5 text-sm',
        md: 'min-h-11 px-5 py-2 text-sm',
        lg: 'min-h-13 px-6 py-2.5 text-base sm:px-7',
        icon: 'size-10',
        'icon-sm': 'size-8',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
)

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {loading && <Loader2 className="animate-spin" />}
            {children}
          </>
        )}
      </Comp>
    )
  },
)
Button.displayName = 'Button'
export { buttonVariants }
