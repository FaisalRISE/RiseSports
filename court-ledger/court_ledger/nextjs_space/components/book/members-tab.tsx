'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { BookCopy, FileText, Loader2, Trash2, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from '@/components/ui/drawer'
import { Amount } from '@/components/amount'
import { calcLedgerFor } from '@/lib/finance'
import type { MemberLite } from '@/lib/finance'
import { ROLE_LABELS, canManageMembers, canSeeAllBalances } from '@/lib/rbac'
import { fmtDate, type BookDetail, type BookSummary } from '@/lib/client-types'

export function MembersTab({ data, reload }: { data: BookDetail; reload: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [directory, setDirectory] = useState<{ name: string; email: string | null }[]>([])
  const [otherBooks, setOtherBooks] = useState<BookSummary[]>([])
  const [copySource, setCopySource] = useState('')
  const [statementFor, setStatementFor] = useState<MemberLite | null>(null)

  const mayManage = canManageMembers(data?.myRole)
  const seeAll = canSeeAllBalances(data?.myRole)

  useEffect(() => {
    if (!mayManage) return
    ;(async () => {
      try {
        const [dirRes, booksRes] = await Promise.all([fetch('/api/directory'), fetch('/api/books')])
        if (dirRes.ok) {
          const d = await dirRes.json()
          setDirectory(d?.people ?? [])
        }
        if (booksRes.ok) {
          const d = await booksRes.json()
          setOtherBooks((d?.books ?? []).filter((b: BookSummary) => b.id !== data?.book?.id))
        }
      } catch (e) {
        console.error('directory load error', e)
      }
    })()
  }, [mayManage, data?.book?.id])

  const suggestions = useMemo(() => {
    const q = name.toLowerCase().trim()
    if (q.length < 2) return []
    const existingEmails = new Set((data?.members ?? []).map((m) => m.email ?? ''))
    const existingNames = new Set((data?.members ?? []).map((m) => m.name.toLowerCase()))
    return directory
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) &&
          !existingNames.has(p.name.toLowerCase()) &&
          !(p.email && existingEmails.has(p.email))
      )
      .slice(0, 4)
  }, [name, directory, data])

  const addMember = async (n?: string, e?: string | null) => {
    const memberName = (n ?? name).trim()
    const memberEmail = (e ?? email).trim()
    if (!memberName || busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/books/${data.book.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: memberName, email: memberEmail }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) toast.error(d?.error ?? 'Could not add member.')
      else {
        toast.success(`${memberName} added`)
        setName('')
        setEmail('')
        await reload()
      }
    } finally {
      setBusy(false)
    }
  }

  const copyMembers = async () => {
    if (!copySource || busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/books/${data.book.id}/members/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceBookId: copySource }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) toast.error(d?.error ?? 'Could not copy members.')
      else {
        toast.success(`${d?.added ?? 0} member${d?.added === 1 ? '' : 's'} copied`)
        setCopySource('')
        await reload()
      }
    } finally {
      setBusy(false)
    }
  }

  const setRole = async (m: MemberLite, role: string) => {
    const res = await fetch(`/api/books/${data.book.id}/members/${m.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) toast.error(d?.error ?? 'Could not change role.')
    else {
      toast.success(`${m.name} is now ${ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? role}`)
      await reload()
    }
  }

  const removeMember = async (m: MemberLite) => {
    if (!confirm(`Remove ${m.name} from this book?`)) return
    const res = await fetch(`/api/books/${data.book.id}/members/${m.id}`, { method: 'DELETE' })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) toast.error(d?.error ?? 'Could not remove member.')
    else {
      toast.success(`${m.name} removed`)
      await reload()
    }
  }

  const mayViewStatement = (m: MemberLite) => seeAll || m.id === data?.myMemberId

  const ledger = statementFor ? calcLedgerFor(data, statementFor.id) : []

  return (
    <div className="space-y-4 pb-8">
      {mayManage && (
        <div className="rounded-xl bg-card p-4 shadow-sm space-y-2.5">
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <UserPlus className="h-4 w-4 text-primary" /> Quick add — press Enter to add & repeat
          </div>
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <Input
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addMember()}
            />
            <Input
              placeholder="Email (optional)"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addMember()}
            />
            <Button onClick={() => addMember()} disabled={busy || !name.trim()} aria-label="Add member">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            </Button>
          </div>
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  className="px-2.5 py-1 rounded-full bg-accent text-xs hover:bg-primary/20 transition-colors"
                  onClick={() => addMember(s.name, s.email)}
                >
                  {s.name}
                  {s.email ? ` · ${s.email}` : ''}
                </button>
              ))}
            </div>
          )}
          {otherBooks.length > 0 && (
            <div className="flex gap-2 pt-1">
              <Select value={copySource} onValueChange={setCopySource}>
                <SelectTrigger className="h-9 text-xs flex-1">
                  <SelectValue placeholder="Copy members from another book…" />
                </SelectTrigger>
                <SelectContent>
                  {otherBooks.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name} ({b.memberCount})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="h-9" disabled={!copySource || busy} onClick={copyMembers}>
                <BookCopy className="h-3.5 w-3.5" /> Copy
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        {(data?.members ?? []).map((m) => (
          <div key={m.id} className="rounded-xl bg-card p-3.5 shadow-sm flex items-center justify-between gap-2">
            <div className="flex items-center gap-3 min-w-0">
              <span
                className="h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                style={{ backgroundColor: `${m.color}26`, color: m.color }}
              >
                {m.name
                  .split(' ')
                  .map((w) => w[0])
                  .slice(0, 2)
                  .join('')
                  .toUpperCase()}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">
                  {m.name}
                  {m.id === data?.myMemberId && <span className="text-primary"> (you)</span>}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {m.email || 'no email'}
                  {seeAll && data?.balances?.[m.id] != null && (
                    <>
                      {' · '}
                      <Amount paise={data.balances[m.id]} signed className="text-xs" />
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {mayViewStatement(m) && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground"
                  aria-label={`View ${m.name}'s statement`}
                  onClick={() => setStatementFor(m)}
                >
                  <FileText className="h-3.5 w-3.5" />
                </Button>
              )}
              {mayManage && m.role !== 'PRIMARY_ADMIN' ? (
                <>
                  <Select value={m.role} onValueChange={(v) => setRole(m, v)}>
                    <SelectTrigger className="h-8 w-[118px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BOOK_ADMIN">Book Admin</SelectItem>
                      <SelectItem value="DATA_OPERATOR">Data Operator</SelectItem>
                      <SelectItem value="VIEWER">Viewer</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-negative"
                    aria-label={`Remove ${m.name}`}
                    onClick={() => removeMember(m)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </>
              ) : (
                <span className="text-[10px] px-2 py-1 rounded-full bg-primary/15 text-primary font-semibold whitespace-nowrap">
                  {ROLE_LABELS[m.role] ?? m.role}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Statement drawer */}
      <Drawer open={!!statementFor} onOpenChange={(o) => !o && setStatementFor(null)}>
        <DrawerContent className="max-h-[92dvh]">
          <DrawerHeader>
            <DrawerTitle>{statementFor?.name}&apos;s Statement</DrawerTitle>
            <DrawerDescription>Every entry, share, and settlement with a running balance.</DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-8 overflow-y-auto">
            {ledger.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No entries involve this member yet.</p>
            ) : (
              <div className="space-y-2">
                {ledger.map((r, i) => (
                  <div key={i} className="rounded-lg bg-card p-3 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium min-w-0 truncate">{r.title}</div>
                      <Amount paise={r.delta} signed className="text-sm shrink-0" />
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{r.sub}</div>
                    <div className="flex items-center justify-between mt-1 text-xs text-muted-foreground">
                      <span>{fmtDate(r.at)}</span>
                      <span>
                        Balance: <Amount paise={r.run ?? 0} signed className="text-xs" />
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  )
}
