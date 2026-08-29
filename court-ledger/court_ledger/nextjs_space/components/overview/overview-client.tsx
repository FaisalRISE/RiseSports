'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  Bell,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Amount } from '@/components/amount'
import { formatMoney } from '@/lib/finance'
import { fmtRelative, type OverviewData } from '@/lib/client-types'
import { ROLE_LABELS } from '@/lib/rbac'

export function OverviewClient() {
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [openPerson, setOpenPerson] = useState<string | null>(null)
  const [acking, setAcking] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/overview')
      if (!res.ok) throw new Error('failed')
      setData(await res.json())
    } catch (e) {
      console.error('overview load error', e)
      toast.error('Could not load your overview.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const ack = async (bookId: string, paymentId: string, action: 'confirm' | 'decline') => {
    setAcking(paymentId)
    try {
      const res = await fetch(`/api/books/${bookId}/payments/${paymentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(d?.error ?? 'Could not update payment.')
      } else {
        toast.success(action === 'confirm' ? 'Payment confirmed — balances updated.' : 'Payment declined.')
        await load()
      }
    } catch {
      toast.error('Could not update payment.')
    } finally {
      setAcking(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="px-5 pt-10 text-center text-muted-foreground">
        Could not load your overview. Pull to refresh or try again later.
      </div>
    )
  }

  const total = data.grandTotal ?? 0
  const firstName = (data.userName ?? '').split(' ')[0] || 'there'

  return (
    <div className="px-4 pt-6 space-y-5">
      <header>
        <p className="text-sm text-muted-foreground">Hi {firstName} 👋</p>
        <h1 className="text-xl font-bold tracking-tight">My Overview</h1>
      </header>

      {/* Pending acknowledgments */}
      {(data.pendingForMe?.length ?? 0) > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-secondary/40 bg-secondary/10 p-4 space-y-3 shadow-sm"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-secondary">
            <Bell className="h-4 w-4" /> Payments awaiting your confirmation
          </div>
          {data.pendingForMe.map((p) => (
            <div key={p.paymentId} className="flex items-center justify-between gap-2">
              <div className="text-sm">
                <span className="font-semibold">{p.fromName}</span> marked{' '}
                <span className="font-mono font-semibold">{formatMoney(p.amount)}</span> paid to you via {p.mode}
                <span className="block text-xs text-muted-foreground">
                  {p.bookName} · {fmtRelative(p.date)}
                </span>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  disabled={acking === p.paymentId}
                  onClick={() => ack(p.bookId, p.paymentId, 'confirm')}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Confirm
                </Button>
              </div>
            </div>
          ))}
        </motion.div>
      )}

      {/* Grand total hero */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="hero-card rounded-2xl p-5 shadow-lg"
      >
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <Wallet className="h-3.5 w-3.5" /> Net across all books
        </div>
        <div className="mt-2 flex items-end gap-2">
          <span
            className={`text-3xl font-mono font-bold tabular ${total > 0 ? 'text-positive' : total < 0 ? 'text-negative' : ''}`}
          >
            {formatMoney(Math.abs(total))}
          </span>
          {total !== 0 && (
            <span className="text-sm text-muted-foreground pb-1 flex items-center gap-1">
              {total > 0 ? (
                <>
                  <TrendingUp className="h-4 w-4 text-positive" /> to receive
                </>
              ) : (
                <>
                  <TrendingDown className="h-4 w-4 text-negative" /> to pay
                </>
              )}
            </span>
          )}
          {total === 0 && <span className="text-sm text-muted-foreground pb-1">all settled 🎉</span>}
        </div>
        {(data.pendingByMe?.length ?? 0) > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            {data.pendingByMe.length} payment{data.pendingByMe.length > 1 ? 's' : ''} you marked paid
            awaiting confirmation
          </p>
        )}
      </motion.div>

      {/* Per-person consolidated */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
          <Users className="h-4 w-4" /> People
        </h2>
        {(data.people?.length ?? 0) === 0 ? (
          <div className="rounded-xl bg-card p-4 text-sm text-muted-foreground shadow-sm">
            No outstanding balances with anyone. Nice and clean!
          </div>
        ) : (
          <div className="space-y-2">
            {data.people.map((p, i) => {
              const key = `${p.name}-${i}`
              const open = openPerson === key
              return (
                <motion.div
                  key={key}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="rounded-xl bg-card shadow-sm overflow-hidden"
                >
                  <button
                    className="w-full flex items-center justify-between p-3.5 text-left hover:bg-accent/40 transition-colors"
                    onClick={() => setOpenPerson(open ? null : key)}
                    aria-expanded={open}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className="h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold"
                        style={{ backgroundColor: `${p.color}26`, color: p.color }}
                      >
                        {p.name
                          .split(' ')
                          .map((w) => w[0])
                          .slice(0, 2)
                          .join('')
                          .toUpperCase()}
                      </span>
                      <div>
                        <div className="text-sm font-semibold">{p.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {p.total > 0 ? 'owes you' : 'you owe'} across {p.parts?.length ?? 0} book
                          {(p.parts?.length ?? 0) > 1 ? 's' : ''}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Amount paise={Math.abs(p.total)} className={p.total > 0 ? 'text-positive' : 'text-negative'} />
                      <ChevronDown
                        className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
                      />
                    </div>
                  </button>
                  {open && (
                    <div className="border-t border-border/60 px-4 py-2.5 space-y-1.5 bg-accent/20">
                      {(p.parts ?? []).map((part, j) => (
                        <Link
                          key={j}
                          href={`/books/${part.bookId}`}
                          className="flex items-center justify-between text-xs py-1 hover:text-primary transition-colors"
                        >
                          <span className="text-muted-foreground">{part.bookName}</span>
                          <span className="flex items-center gap-1">
                            <Amount
                              paise={Math.abs(part.net)}
                              className={`text-xs ${part.net > 0 ? 'text-positive' : 'text-negative'}`}
                            />
                            <ChevronRight className="h-3 w-3" />
                          </span>
                        </Link>
                      ))}
                    </div>
                  )}
                </motion.div>
              )
            })}
          </div>
        )}
      </section>

      {/* Per-book balances */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
          <BookOpen className="h-4 w-4" /> Your books
        </h2>
        {(data.books?.length ?? 0) === 0 ? (
          <div className="rounded-xl bg-card p-5 text-center shadow-sm">
            <p className="text-sm text-muted-foreground mb-3">You have no books yet.</p>
            <Button asChild size="sm">
              <Link href="/books">Create your first book</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {data.books.map((b, i) => (
              <motion.div
                key={b.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
              >
                <Link
                  href={`/books/${b.id}`}
                  className="flex items-center justify-between rounded-xl bg-card p-3.5 shadow-sm hover:bg-accent/40 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="h-9 w-9 rounded-lg bg-primary/15 text-primary flex items-center justify-center">
                      <BookOpen className="h-4 w-4" />
                    </span>
                    <div>
                      <div className="text-sm font-semibold">{b.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {b.memberCount} member{b.memberCount !== 1 ? 's' : ''} · {ROLE_LABELS[b.role] ?? b.role} ·{' '}
                        {fmtRelative(b.updatedAt)}
                      </div>
                    </div>
                  </div>
                  <Amount paise={b.balance} signed />
                </Link>
              </motion.div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
