'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus, Save, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from '@/components/ui/drawer'
import type { ActivityLite } from '@/lib/finance'
import { canManageMembers } from '@/lib/rbac'
import type { BookDetail } from '@/lib/client-types'
import { cn } from '@/lib/utils'

const TYPES = [
  { value: 'COURT_BOOKING', label: '🏸 Court Booking' },
  { value: 'EQUIPMENT', label: '🎽 Equipment' },
  { value: 'FOOD_DRINKS', label: '🥤 Food & Drinks' },
  { value: 'OTHER', label: '📌 Other' },
]

const QUICK_DURATIONS = [
  { label: '1 hr', mins: 60 },
  { label: '1.5 hrs', mins: 90 },
  { label: '2 hrs', mins: 120 },
  { label: '3 hrs', mins: 180 },
]

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "20:00" -> "8:00 PM" */
function to12h(t: string): string {
  const [hStr, mStr] = t.split(':')
  let h = Number(hStr)
  const suffix = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${mStr} ${suffix}`
}

/** "8:00 PM" -> "20:00" */
function to24h(h: number, m: string, suffix: string): string {
  let hh = h % 12
  if (suffix.toUpperCase() === 'PM') hh += 12
  return `${String(hh).padStart(2, '0')}:${m}`
}

/** Parse "8:00 PM – 10:00 PM" back into 24h times, if possible. */
function parseSlot(slot: string): { start: string; end: string } | null {
  const m = slot.match(/(\d{1,2}):(\d{2})\s*(AM|PM)\s*[–—-]\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i)
  if (!m) return null
  return {
    start: to24h(Number(m[1]), m[2], m[3]),
    end: to24h(Number(m[4]), m[5], m[6]),
  }
}

function addMinutes(t: string, mins: number): string {
  const [h, m] = t.split(':').map(Number)
  const total = (h * 60 + m + mins) % (24 * 60)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

type MemberLite = { id: string; name: string }

export function ActivitySheet({
  open,
  onOpenChange,
  data,
  edit,
  duplicate,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  data: BookDetail
  edit: ActivityLite | null
  duplicate: ActivityLite | null
  onSaved: () => Promise<void>
}) {
  const [type, setType] = useState('COURT_BOOKING')
  const [customType, setCustomType] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState('')
  const [timeMode, setTimeMode] = useState<'slot' | 'none'>('slot')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [legacySlot, setLegacySlot] = useState('') // unparseable slot text preserved on edit
  const [venue, setVenue] = useState('')
  const [note, setNote] = useState('')
  const [payerId, setPayerId] = useState('')
  const [parts, setParts] = useState<string[]>([])
  const [extraMembers, setExtraMembers] = useState<MemberLite[]>([])
  const [showNewMember, setShowNewMember] = useState(false)
  const [newMemberName, setNewMemberName] = useState('')
  const [addingMember, setAddingMember] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setExtraMembers([])
    setShowNewMember(false)
    setNewMemberName('')
    setShowCustom(false)
    setCustomType('')
    const src = edit ?? duplicate
    if (src) {
      setType(src.type)
      setAmount(String((src.amount ?? 0) / 100))
      setDate(edit ? (src.date ?? '').slice(0, 10) : todayStr())
      const slot = src.slotText ?? ''
      const parsed = slot ? parseSlot(slot) : null
      if (parsed) {
        setTimeMode('slot')
        setStartTime(parsed.start)
        setEndTime(parsed.end)
        setLegacySlot('')
      } else if (slot) {
        setTimeMode('slot')
        setStartTime('')
        setEndTime('')
        setLegacySlot(slot)
      } else {
        setTimeMode('none')
        setStartTime('')
        setEndTime('')
        setLegacySlot('')
      }
      setVenue(src.venue ?? '')
      setNote(src.note ?? '')
      setPayerId(src.payerId)
      setParts([...(src.participantIds ?? [])])
    } else {
      setType('COURT_BOOKING')
      setAmount('')
      setDate(todayStr())
      setTimeMode('slot')
      setStartTime('')
      setEndTime('')
      setLegacySlot('')
      setVenue('')
      setNote('')
      setPayerId(data?.myMemberId ?? '')
      setParts((data?.members ?? []).map((m) => m.id))
    }
  }, [open, edit, duplicate, data])

  const members: MemberLite[] = useMemo(
    () => [...(data?.members ?? []), ...extraMembers],
    [data, extraMembers]
  )
  const mayManageMembers = canManageMembers(data?.myRole)

  const toggle = (id: string) =>
    setParts((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  const allSelected = members.length > 0 && parts.length === members.length

  const quickDuration = (mins: number) => {
    const base = startTime || '20:00'
    if (!startTime) setStartTime(base)
    setEndTime(addMinutes(base, mins))
  }

  const addNewMember = async () => {
    const nm = newMemberName.trim()
    if (!nm || addingMember) return
    setAddingMember(true)
    try {
      const res = await fetch(`/api/books/${data.book.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nm }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(d?.error ?? 'Could not add member.')
        return
      }
      const m = d.member as MemberLite
      setExtraMembers((x) => [...x, { id: m.id, name: m.name }])
      setParts((p) => [...p, m.id])
      setNewMemberName('')
      setShowNewMember(false)
      toast.success(`${m.name} added to this book`)
    } finally {
      setAddingMember(false)
    }
  }

  const buildSlotText = (): string => {
    if (timeMode === 'none') return ''
    if (startTime && endTime) return `${to12h(startTime)} – ${to12h(endTime)}`
    return legacySlot
  }

  const save = async () => {
    if (busy) return
    setBusy(true)
    try {
      const finalNote =
        type === 'OTHER' && customType.trim()
          ? [customType.trim(), note.trim()].filter(Boolean).join(' — ')
          : note
      const payload = {
        type,
        amount: Number(amount),
        date,
        slotText: buildSlotText(),
        venue,
        note: finalNote,
        payerId,
        participantIds: parts,
      }
      const url = edit
        ? `/api/books/${data.book.id}/activities/${edit.id}`
        : `/api/books/${data.book.id}/activities`
      const res = await fetch(url, {
        method: edit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(d?.error ?? 'Could not save entry.')
        return
      }
      await onSaved()
    } finally {
      setBusy(false)
    }
  }

  const perHead = parts.length > 0 ? (Number(amount) || 0) / parts.length : 0

  const chip = (on: boolean) =>
    cn(
      'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
      on
        ? 'bg-primary/15 text-primary border-primary font-semibold'
        : 'bg-card text-muted-foreground border-border hover:border-primary/50'
    )

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92dvh]">
        <DrawerHeader>
          <DrawerTitle>{edit ? 'Edit Entry' : duplicate ? 'Duplicate Entry' : 'Add Entry'}</DrawerTitle>
          <DrawerDescription>
            Evenly splits the cost among the selected players.
          </DrawerDescription>
        </DrawerHeader>
        <div className="px-4 pb-8 space-y-4 overflow-y-auto">
          {/* Activity type chips */}
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Activity type</Label>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => {
                    setType(t.value)
                    if (t.value !== 'OTHER') {
                      setShowCustom(false)
                      setCustomType('')
                    }
                  }}
                  className={chip(type === t.value)}
                  aria-pressed={type === t.value}
                >
                  {t.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setType('OTHER')
                  setShowCustom(true)
                }}
                className={chip(showCustom)}
                aria-label="Add custom activity type"
              >
                <Plus className="h-3.5 w-3.5 inline" />
              </button>
            </div>
            {showCustom && (
              <Input
                placeholder="Name this activity (e.g. Yonex Shuttles)"
                value={customType}
                onChange={(e) => setCustomType(e.target.value)}
                className="mt-2"
              />
            )}
          </div>

          {/* Amount */}
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Total amount paid (₹)</Label>
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 font-mono text-lg h-11"
            />
          </div>

          {/* Paid by chips */}
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Booked & paid by</Label>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPayerId(m.id)}
                  className={chip(payerId === m.id)}
                  aria-pressed={payerId === m.id}
                >
                  {m.name}
                  {m.id === data?.myMemberId ? ' (you)' : ''}
                </button>
              ))}
            </div>
          </div>

          {/* Date + time option */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Time option</Label>
              <div className="flex gap-1.5 mt-1.5">
                <button type="button" onClick={() => setTimeMode('slot')} className={chip(timeMode === 'slot')}>
                  Slot Range
                </button>
                <button type="button" onClick={() => setTimeMode('none')} className={chip(timeMode === 'none')}>
                  No Time
                </button>
              </div>
            </div>
          </div>

          {timeMode === 'slot' && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Start time</Label>
                  <Input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">End time</Label>
                  <Input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="mt-1"
                  />
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs text-muted-foreground">Quick duration:</span>
                {QUICK_DURATIONS.map((q) => (
                  <button
                    key={q.label}
                    type="button"
                    onClick={() => quickDuration(q.mins)}
                    className="px-2.5 py-1 rounded-full text-xs bg-card border border-border hover:border-primary/50 transition-colors"
                  >
                    {q.label}
                  </button>
                ))}
              </div>
              {legacySlot && !startTime && !endTime && (
                <p className="text-[11px] text-muted-foreground">
                  Current slot: “{legacySlot}” — pick times above to replace it.
                </p>
              )}
            </div>
          )}

          {/* Venue */}
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Venue / sports arena</Label>
            <Input
              placeholder="e.g. ASC Sports Club, Andheri"
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              className="mt-1"
            />
          </div>

          {/* Players involved */}
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Players involved ({parts.length})
              </Label>
              <button
                type="button"
                className="text-xs font-semibold text-primary"
                onClick={() => setParts(allSelected ? [] : members.map((m) => m.id))}
              >
                {allSelected ? 'Clear All' : 'Select All'}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {members.map((m) => {
                const on = parts.includes(m.id)
                return (
                  <button key={m.id} type="button" onClick={() => toggle(m.id)} className={chip(on)} aria-pressed={on}>
                    {on ? '✓ ' : ''}
                    {m.name}
                  </button>
                )
              })}
              {mayManageMembers && (
                <button
                  type="button"
                  onClick={() => setShowNewMember((v) => !v)}
                  className={chip(showNewMember)}
                >
                  <UserPlus className="h-3.5 w-3.5 inline mr-1" />
                  New Member
                </button>
              )}
            </div>
            {showNewMember && (
              <div className="flex gap-2 mt-2">
                <Input
                  placeholder="New member name"
                  value={newMemberName}
                  onChange={(e) => setNewMemberName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addNewMember()}
                />
                <Button
                  variant="outline"
                  className="shrink-0"
                  onClick={addNewMember}
                  disabled={addingMember || !newMemberName.trim()}
                >
                  {addingMember ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}
                </Button>
              </div>
            )}
          </div>

          {/* Split preview */}
          <div
            className={cn(
              'rounded-xl border p-3 text-sm',
              perHead > 0
                ? 'border-primary/40 bg-primary/10 text-foreground'
                : 'border-border bg-card text-muted-foreground'
            )}
          >
            {perHead > 0 ? (
              <>
                Split: <span className="font-mono font-semibold">₹{perHead.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>{' '}
                each for {parts.length} player{parts.length === 1 ? '' : 's'}
              </>
            ) : (
              'Enter the total amount and select playing members to preview individual splits.'
            )}
          </div>

          {/* Notes */}
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Notes (optional)</Label>
            <Input
              placeholder="e.g. Court 2, tournament practice"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="mt-1"
            />
          </div>

          <Button
            className="w-full h-11 font-semibold"
            onClick={save}
            disabled={busy || !amount || !payerId || parts.length === 0}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {edit ? 'Save Changes' : 'Add Entry'}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
