'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { Copy, Filter, Pencil, Search, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Amount } from '@/components/amount'
import { typeMeta, calcShares } from '@/lib/finance'
import type { ActivityLite } from '@/lib/finance'
import { canEditEntry as canEdit, canDeleteEntry as canDelete } from '@/lib/rbac'
import { fmtDate, type BookDetail } from '@/lib/client-types'
import { useSession } from 'next-auth/react'

const TYPE_OPTIONS = [
  { value: 'COURT_BOOKING', label: '🏸 Court Booking' },
  { value: 'EQUIPMENT', label: '🎽 Equipment' },
  { value: 'FOOD_DRINKS', label: '🥤 Food & Drinks' },
  { value: 'OTHER', label: '📌 Other' },
]

export function EntriesTab({
  data,
  reload,
  onEdit,
  onDuplicate,
}: {
  data: BookDetail
  reload: () => Promise<void>
  onEdit: (a: ActivityLite) => void
  onDuplicate: (a: ActivityLite) => void
}) {
  const { data: session } = useSession()
  const userId = (session?.user as { id?: string } | undefined)?.id ?? ''
  const [query, setQuery] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [typeFilter, setTypeFilter] = useState('all')
  const [memberFilter, setMemberFilter] = useState('all')
  const [venueFilter, setVenueFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const venues = useMemo(
    () =>
      Array.from(
        new Set((data?.activities ?? []).map((a) => (a.venue ?? '').trim()).filter(Boolean))
      ).sort(),
    [data]
  )

  const memberName = (id: string) => data?.members?.find((m) => m.id === id)?.name ?? '—'

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    return (data?.activities ?? []).filter((a) => {
      if (typeFilter !== 'all' && a.type !== typeFilter) return false
      if (memberFilter !== 'all' && a.payerId !== memberFilter && !(a.participantIds ?? []).includes(memberFilter))
        return false
      if (venueFilter !== 'all' && (a.venue ?? '') !== venueFilter) return false
      if (dateFrom && new Date(a.date) < new Date(dateFrom)) return false
      if (dateTo && new Date(a.date) > new Date(dateTo + 'T23:59:59')) return false
      if (q) {
        const hay = [
          a.venue ?? '',
          a.note ?? '',
          a.slotText ?? '',
          typeMeta(a.type).label,
          memberName(a.payerId),
          ...(a.participantIds ?? []).map(memberName),
        ]
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, query, typeFilter, memberFilter, venueFilter, dateFrom, dateTo])

  const hasFilter = typeFilter !== 'all' || memberFilter !== 'all' || venueFilter !== 'all' || dateFrom || dateTo

  const deleteActivity = async (a: ActivityLite) => {
    if (!confirm('Delete this entry? Balances will update.')) return
    const res = await fetch(`/api/books/${data.book.id}/activities/${a.id}`, { method: 'DELETE' })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) toast.error(d?.error ?? 'Could not delete entry.')
    else {
      toast.success('Entry deleted')
      await reload()
    }
  }

  return (
    <div className="space-y-3 pb-8">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search venue, note, member…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button
          variant={showFilters || hasFilter ? 'default' : 'outline'}
          size="icon"
          onClick={() => setShowFilters((v) => !v)}
          aria-label="Toggle filters"
        >
          <Filter className="h-4 w-4" />
        </Button>
      </div>

      {showFilters && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="rounded-xl bg-card p-3 space-y-2 shadow-sm"
        >
          <div className="grid grid-cols-2 gap-2">
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {TYPE_OPTIONS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={memberFilter} onValueChange={setMemberFilter}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Member" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All members</SelectItem>
                {(data?.members ?? []).map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {venues.length > 0 && (
              <Select value={venueFilter} onValueChange={setVenueFilter}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Venue" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All venues</SelectItem>
                  {venues.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="col-span-2 grid grid-cols-2 gap-2">
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-9 text-xs"
                aria-label="From date"
              />
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-9 text-xs"
                aria-label="To date"
              />
            </div>
          </div>
          {hasFilter && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground"
              onClick={() => {
                setTypeFilter('all')
                setMemberFilter('all')
                setVenueFilter('all')
                setDateFrom('')
                setDateTo('')
              }}
            >
              <X className="h-3 w-3" /> Clear filters
            </Button>
          )}
        </motion.div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-xl bg-card p-8 text-center text-sm text-muted-foreground shadow-sm">
          {data?.activities?.length ? 'No entries match your filters.' : 'No entries yet — add your first booking!'}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((a, i) => {
            const t = typeMeta(a.type)
            const shares = calcShares(data, a)
            const perHead = Object.values(shares ?? {})[0] ?? 0
            const mayEdit = canEdit(data.myRole, a.createdByUserId, userId)
            const mayDelete = canDelete(data.myRole, a.createdByUserId, userId)
            return (
              <motion.div
                key={a.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.02, 0.4) }}
                className="rounded-xl bg-card p-3.5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex gap-3 min-w-0">
                    <span className="h-9 w-9 rounded-lg bg-accent flex items-center justify-center text-base shrink-0">
                      {t.emoji}
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">
                        {t.label}
                        {a.venue ? ` · ${a.venue}` : ''}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {fmtDate(a.date)}
                        {a.slotText ? ` · ${a.slotText}` : ''} · paid by{' '}
                        <span className="font-medium text-foreground/80">{memberName(a.payerId)}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Split {(a.participantIds ?? []).length} ways · ~<Amount paise={perHead} className="text-xs font-normal" /> each
                        {a.note ? ` · ${a.note}` : ''}
                      </div>
                    </div>
                  </div>
                  <Amount paise={a.amount} className="shrink-0" />
                </div>
                <div className="flex justify-end gap-1 mt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground"
                    onClick={() => onDuplicate(a)}
                  >
                    <Copy className="h-3 w-3" /> Duplicate
                  </Button>
                  {mayEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-muted-foreground"
                      onClick={() => onEdit(a)}
                    >
                      <Pencil className="h-3 w-3" /> Edit
                    </Button>
                  )}
                  {mayDelete && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-negative"
                      onClick={() => deleteActivity(a)}
                    >
                      <Trash2 className="h-3 w-3" /> Delete
                    </Button>
                  )}
                </div>
              </motion.div>
            )
          })}
        </div>
      )}
    </div>
  )
}
