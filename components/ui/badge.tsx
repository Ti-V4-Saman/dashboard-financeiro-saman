import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-[var(--ink)] text-white hover:bg-[var(--ink2)]',
        secondary:
          'border-transparent bg-[var(--surf2)] text-[var(--ink2)] hover:bg-[var(--surf3)]',
        destructive:
          'border-transparent bg-[var(--red-l)] text-[var(--red)]',
        outline: 'text-foreground',
        green:
          'border-transparent bg-[var(--green-l)] text-[var(--green)]',
        amber:
          'border-transparent bg-[var(--amber-l)] text-[var(--amber)]',
        blue:
          'border-transparent bg-[var(--blue-l)] text-[var(--blue)]',
        red:
          'border-transparent bg-[var(--red-l)] text-[var(--red)]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
