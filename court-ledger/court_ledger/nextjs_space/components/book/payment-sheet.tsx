'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { BellRing, CheckCircle2, Loader2 } from 'lucide-react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { BookDetail } from '@/lib/client-types'

export interface PaymentPrefill {
  fromId: string
  toId: string
  amount: number // paise
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function PaymentSheet({
  prefill,
  onOpenChange,
  data,
  onSaved,
}: {
  prefill: PaymentPrefill | null
  onOpenChange: (o: boolean) => void
  data: BookDetail
  onSaved: () => Promise<void>
}) {
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState('UPI')
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (prefill) {
      setFromId(prefill.fromId)
      setToId(prefill.toId)
      setAmount(String((prefill.amount ?? 0) / 100))
      setMode('UPI')
      setDate(todayStr())
      setNote('')
    }
  }, [prefill])

  const save = async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/books/${data.book.id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromId, toId, amount: Number(amount), mode, note, date }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(d?.error ?? 'Could not log payment.')
        return
      }
      toast.success(`Marked as paid — ${name(toId)} will be notified to confirm receipt.`)
      await onSaved()
    } finally {
      setBusy(false)
    }
  }

  const name = (id: string) => data?.members?.find((m) => m.id === id)?.name ?? '—'

  return (
    <Drawer open={!!prefill} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Record a Payment</DrawerTitle>
          <DrawerDescription>
            {fromId && toId ? `${name(fromId)} pays ${name(toId)}. ` : ''}
            Log any amount — settle a due, pay partially, or pay extra in advance. The recipient must confirm receipt.
          </DrawerDescription>
        </DrawerHeader>
        <div className="px-4 pb-8 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">From</Label>
              <Select value={fromId} onValueChange={setFromId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Payer" />
                </SelectTrigger>
                <SelectContent>
                  {(data?.members ?? []).map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Select value={toId} onValueChange={setToId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Recipient" />
                </SelectTrigger>
                <SelectContent>
                  {(data?.members ?? []).map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Amount (₹)</Label>
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1 font-mono"
              />
            </div>
            <div>
              <Label className="text-xs">Mode</Label>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="UPI">UPI</SelectItem>
                  <SelectItem value="Cash">Cash</SelectItem>
                  <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Paid on (date)</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Note</Label>
            <Input placeholder="Optional note" value={note} onChange={(e) => setNote(e.target.value)} className="mt-1" />
          </div>
          <div className="rounded-xl border border-secondary/40 bg-secondary/10 p-3 flex items-start gap-2 text-xs text-muted-foreground">
            <BellRing className="h-4 w-4 text-secondary shrink-0 mt-0.5" />
            <span>
              <span className="font-semibold text-foreground">Two-party acknowledgement:</span> when you tap
              “Mark as Paid”, {toId ? name(toId) : 'the recipient'} will see a notification to acknowledge receipt.
              Dues officially clear only once they confirm.
            </span>
          </div>
          <Button
            className="w-full h-11 font-semibold"
            onClick={save}
            disabled={busy || !fromId || !toId || fromId === toId || !(Number(amount) > 0)}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Mark as Paid
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
