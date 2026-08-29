'use client'

import { formatMoney } from '@/lib/finance'
import { cn } from '@/lib/utils'

export function Amount({
  paise,
  signed = false,
  className,
}: {
  paise: number
  signed?: boolean
  className?: string
}) {
  const v = paise ?? 0
  return (
    <span
      className={cn(
        'font-mono tabular font-semibold',
        signed && v > 0 && 'text-positive',
        signed && v < 0 && 'text-negative',
        className
      )}
    >
      {signed && v > 0 ? '+' : ''}
      {formatMoney(v)}
    </span>
  )
}
