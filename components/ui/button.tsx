import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'bg-[var(--ink)] text-white shadow hover:bg-[var(--ink2)]',
        destructive:
          'bg-[var(--red)] text-white shadow-sm hover:bg-[var(--brand)]',
        outline:
          'border border-[var(--line2)] bg-transparent shadow-sm hover:bg-[var(--surf2)] text-[var(--ink2)]',
        secondary:
          'bg-[var(--surf2)] text-[var(--ink2)] shadow-sm hover:bg-[var(--surf3)]',
        ghost: 'hover:bg-[var(--surf2)] text-[var(--ink2)]',
        link: 'text-[var(--blue)] underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-7 px-3 py-1',
        sm: 'h-6 px-2 text-xs',
        lg: 'h-9 px-4',
        icon: 'h-7 w-7',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
