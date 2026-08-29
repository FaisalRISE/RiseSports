'use client'

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { BarChart3, CalendarRange, Loader2 } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Amount } from '@/components/amount'
import { calcShares } from '@/lib/finance'
import type { BookDetail } from '@/lib/client-types'

const SpendChart = dynamic(() => import('./spend-chart'), {
  ssr: false,
  loading: () => (
    <div className="h-52 flex items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-primary" />
    </div>
  ),
})

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function ReportsTab({ data }: { data: BookDetail }) {
  const availableMonths = useMemo(() => {
    const keys = new Set<string>()
    ;(data?.activities ?? []).forEach((a) => keys.add(monthKey(new Date(a.date))))
    return Array.from(keys).sort().reverse()
  }, [data])

  const [month, setMonth] = useState<string>(availableMonths[0] ?? '')

  useEffect(() => {
    if (!month) setMonth(availableMonths[0] ?? monthKey(new Date()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableMonths])

  const monthLabel = (key: string) => {
    const [y, m] = key.split('-')
    return `${MONTHS[Number(m) - 1] ?? m} ${y}`
  }

  const summary = useMemo(() => {
    const acts = (data?.activities ?? []).filter((a) => monthKey(new Date(a.date)) === month)
    let total = 0
    const paidBy: Record<string, number> = {}
    const shareOf: Record<string, number> = {}
    const venues: Record<string, number> = {}
    acts.forEach((a) => {
      total += a.amount ?? 0
      paidBy[a.payerId] = (paidBy[a.payerId] ?? 0) + (a.amount ?? 0)
      if (a.venue) venues[a.venue] = (venues[a.venue] ?? 0) + 1
      const s = calcShares(data, a)
      Object.keys(s ?? {}).forEach((pid) => {
        shareOf[pid] = (shareOf[pid] ?? 0) + s[pid]
      })
    })
    const topVenue = Object.entries(venues).sort((a, b) => b[1] - a[1])[0]?.[0]
    return { acts, total, paidBy, shareOf, topVenue }
  }, [data, month])

  const chartData = useMemo(() => {
    const byMonth: Record<string, number> = {}
    ;(data?.activities ?? []).forEach((a) => {
      const k = monthKey(new Date(a.date))
      byMonth[k] = (byMonth[k] ?? 0) + (a.amount ?? 0)
    })
    return Object.keys(byMonth)
      .sort()
      .slice(-6)
      .map((k) => ({ month: monthLabel(k), spend: Math.round((byMonth[k] ?? 0) / 100) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const name = (id: string) => data?.members?.find((m) => m.id === id)?.name ?? '—'

  return (
    <div className="space-y-4 pb-8">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-1.5">
          <CalendarRange className="h-4 w-4 text-primary" /> Monthly summary
        </h2>
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger className="h-8 w-[130px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(availableMonths.length ? availableMonths : [month]).map((k) => (
              <SelectItem key={k} value={k}>
                {monthLabel(k)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="hero-card rounded-xl p-4">
          <div className="text-xs text-muted-foreground">Total spent</div>
          <div className="text-xl font-mono font-bold mt-1">
            <Amount paise={summary.total} className="text-xl" />
          </div>
        </div>
        <div className="rounded-xl bg-card p-4 shadow-sm">
          <div className="text-xs text-muted-foreground">Entries</div>
          <div className="text-xl font-mono font-bold mt-1">{summary.acts.length}</div>
          {summary.topVenue && (
            <div className="text-xs text-muted-foreground mt-0.5 truncate">Top venue: {summary.topVenue}</div>
          )}
        </div>
      </div>

      {Object.keys(summary.shareOf).length > 0 && (
        <div className="rounded-xl bg-card p-4 shadow-sm">
          <h3 className="text-sm font-semibold mb-2.5">Per-person — {monthLabel(month)}</h3>
          <div className="space-y-1.5">
            {Object.keys(summary.shareOf)
              .sort((a, b) => (summary.shareOf[b] ?? 0) - (summary.shareOf[a] ?? 0))
              .map((pid) => (
                <div key={pid} className="flex items-center justify-between text-sm">
                  <span className="truncate">{name(pid)}</span>
                  <span className="text-xs text-muted-foreground">
                    share <Amount paise={summary.shareOf[pid] ?? 0} className="text-xs" />
                    {' · paid '}
                    <Amount paise={summary.paidBy[pid] ?? 0} className="text-xs" />
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      <div className="rounded-xl bg-card p-4 shadow-sm">
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
          <BarChart3 className="h-4 w-4 text-secondary" /> Spending trend (₹)
        </h3>
        {chartData.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Add entries to see the trend.</p>
        ) : (
          <SpendChart data={chartData} />
        )}
      </div>
    </div>
  )
}
