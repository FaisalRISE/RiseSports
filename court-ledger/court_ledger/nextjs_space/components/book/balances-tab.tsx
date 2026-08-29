'use client'

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  FileText,
  Handshake,
  History,
  ImageIcon,
  Loader2,
  MessageCircle,
  Plus,
  Share2,
  Sparkles,
  Wallet,
} from 'lucide-react'
import { toPng } from 'html-to-image'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Amount } from '@/components/amount'
import { formatMoney } from '@/lib/finance'
import { canAddEntries, canSeeAllBalances, canSeeOwnPairs } from '@/lib/rbac'
import { fmtDate, type BookDetail } from '@/lib/client-types'
import type { PaymentPrefill } from './payment-sheet'

export function BalancesTab({
  data,
  onSettle,
  reload,
}: {
  data: BookDetail
  onSettle: (p: PaymentPrefill) => void
  reload: () => Promise<void>
}) {
  const [openPair, setOpenPair] = useState<string | null>(null)
  const [acking, setAcking] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [todayIso, setTodayIso] = useState('')
  useEffect(() => setTodayIso(new Date().toISOString()), [])
  const cardRef = useRef<HTMLDivElement>(null)

  const name = (id: string) => data?.members?.find((m) => m.id === id)?.name ?? '—'
  const color = (id: string) => data?.members?.find((m) => m.id === id)?.color ?? '#8899b4'
  const isMe = (id: string) => id === data?.myMemberId
  const nameOrYou = (id: string) => (isMe(id) ? 'You' : name(id))

  const myBalance = data?.balances?.[data?.myMemberId] ?? 0
  const seeAll = canSeeAllBalances(data?.myRole)
  const seeOwn = canSeeOwnPairs(data?.myRole)
  const maySettle = canAddEntries(data?.myRole)

  const pendingForMe = (data?.payments ?? []).filter(
    (p) => p.status === 'PENDING' && p.toId === data?.myMemberId
  )
  const pendingByMe = (data?.payments ?? []).filter(
    (p) => p.status === 'PENDING' && p.fromId === data?.myMemberId
  )

  // Own-perspective pair nets: positive → I owe them, negative → they owe me
  const myPairs = (data?.pairs ?? [])
    .filter((p) => p.a === data?.myMemberId || p.b === data?.myMemberId)
    .map((p) => ({
      other: p.a === data?.myMemberId ? p.b : p.a,
      net: p.a === data?.myMemberId ? p.net : -p.net,
    }))
    .filter((x) => x.net !== 0)
  const owedToMe = myPairs
    .filter((x) => x.net < 0)
    .map((x) => ({ id: x.other, amount: -x.net }))
    .sort((a, b) => b.amount - a.amount)
  const iOwe = myPairs
    .filter((x) => x.net > 0)
    .map((x) => ({ id: x.other, amount: x.net }))
    .sort((a, b) => b.amount - a.amount)
  const owedToMeTotal = seeOwn
    ? owedToMe.reduce((s, x) => s + x.amount, 0)
    : Math.max(myBalance, 0)
  const iOweTotal = seeOwn ? iOwe.reduce((s, x) => s + x.amount, 0) : Math.max(-myBalance, 0)

  const ack = async (paymentId: string, action: 'confirm' | 'decline') => {
    setAcking(paymentId)
    try {
      const res = await fetch(`/api/books/${data.book.id}/payments/${paymentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) toast.error(d?.error ?? 'Could not update payment.')
      else {
        toast.success(action === 'confirm' ? 'Payment confirmed — balances updated.' : 'Payment declined.')
        await reload()
      }
    } finally {
      setAcking(null)
    }
  }

  const shareSummary = async () => {
    const lines: string[] = [`🏸 *${data?.book?.name}* — balance summary`]
    if (seeAll) {
      ;(data?.members ?? []).forEach((m) => {
        const b = data?.balances?.[m.id] ?? 0
        if (b === 0) return
        lines.push(`${b > 0 ? '🟢' : '🔴'} ${m.name}: ${b > 0 ? 'receives' : 'owes'} ${formatMoney(Math.abs(b))}`)
      })
      if ((data?.settleUp?.length ?? 0) > 0) {
        lines.push('', '💡 *Settle up:*')
        data.settleUp.forEach((s) => lines.push(`• ${name(s.from)} → ${name(s.to)}: ${formatMoney(s.amount)}`))
      }
    } else {
      lines.push(
        `Your balance: ${myBalance > 0 ? 'receive' : myBalance < 0 ? 'pay' : 'settled'} ${formatMoney(Math.abs(myBalance))}`
      )
      ;(data?.pairs ?? []).forEach((p) => {
        const other = p.a === data.myMemberId ? p.b : p.a
        const net = p.a === data.myMemberId ? p.net : -p.net // positive → I owe other
        if (!net) return
        lines.push(`${net > 0 ? '🔴 You owe' : '🟢 Owes you'} ${name(other)}: ${formatMoney(Math.abs(net))}`)
      })
    }
    const text = lines.join('\n')
    try {
      if (navigator?.share) {
        await navigator.share({ text })
        return
      }
    } catch {
      /* fall through to WhatsApp link */
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
  }

  const renderCardPng = async (): Promise<string | null> => {
    if (!cardRef.current) return null
    try {
      return await toPng(cardRef.current, { pixelRatio: 2, cacheBust: true })
    } catch (e) {
      console.error('share card render error', e)
      return null
    }
  }

  const downloadDataUrl = (dataUrl: string, filename: string) => {
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const safeBookName = () => (data?.book?.name ?? 'balances').replace(/[^\w-]+/g, '_')

  const shareAsImage = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const dataUrl = await renderCardPng()
      if (!dataUrl) {
        toast.error('Could not create the image.')
        return
      }
      // Try native share with the image file (great for WhatsApp on mobile)
      try {
        const blob = await (await fetch(dataUrl)).blob()
        const file = new File([blob], `${safeBookName()}-balances.png`, { type: 'image/png' })
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: `${data?.book?.name} — balances` })
          return
        }
      } catch {
        /* fall through to download */
      }
      downloadDataUrl(dataUrl, `${safeBookName()}-balances.png`)
      toast.success('Balance summary image downloaded')
    } finally {
      setExporting(false)
    }
  }

  const shareAsPdf = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const dataUrl = await renderCardPng()
      if (!dataUrl || !cardRef.current) {
        toast.error('Could not create the PDF.')
        return
      }
      const { jsPDF } = await import('jspdf')
      const w = cardRef.current.offsetWidth
      const h = cardRef.current.offsetHeight
      const pdf = new jsPDF({
        orientation: h > w ? 'portrait' : 'landscape',
        unit: 'px',
        format: [w, h],
      })
      pdf.addImage(dataUrl, 'PNG', 0, 0, w, h)
      pdf.save(`${safeBookName()}-balances.pdf`)
      toast.success('Balance summary PDF downloaded')
    } finally {
      setExporting(false)
    }
  }

  const pairHistory = (a: string, b: string) =>
    (data?.payments ?? [])
      .filter(
        (p) =>
          (p.fromId === a && p.toId === b) || (p.fromId === b && p.toId === a)
      )
      .sort((x, y) => new Date(y.date).getTime() - new Date(x.date).getTime())

  return (
    <div className="space-y-4 pb-8">
      {/* Pending confirmations for me */}
      {pendingForMe.length > 0 && (
        <div className="rounded-xl border border-secondary/40 bg-secondary/10 p-4 space-y-2.5">
          {pendingForMe.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2">
              <div className="text-sm">
                🔔 <span className="font-semibold">{name(p.fromId)}</span> marked{' '}
                <span className="font-mono font-semibold">{formatMoney(p.amount)}</span> paid to you via {p.mode}
              </div>
              <div className="flex gap-1.5 shrink-0">
                <Button size="sm" className="h-8 text-xs" disabled={acking === p.id} onClick={() => ack(p.id, 'confirm')}>
                  <CheckCircle2 className="h-3.5 w-3.5" /> Confirm
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  disabled={acking === p.id}
                  onClick={() => ack(p.id, 'decline')}
                >
                  Decline
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Awaiting confirmation on payments I marked as paid */}
      {pendingByMe.length > 0 && (
        <div className="rounded-xl border border-border/60 bg-card p-3.5 space-y-1.5">
          {pendingByMe.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                ⏳ You marked <span className="font-mono font-semibold text-foreground">{formatMoney(p.amount)}</span> paid
                to <span className="font-semibold text-foreground">{name(p.toId)}</span> — awaiting their confirmation
              </span>
            </div>
          ))}
        </div>
      )}

      {/* My balance hero */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="hero-card rounded-2xl p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground">
              <Wallet className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate font-semibold">{data?.book?.name} · Balance</span>
            </div>
            <div
              className={`mt-1.5 text-3xl font-mono font-bold tabular ${myBalance > 0 ? 'text-positive' : myBalance < 0 ? 'text-negative' : ''}`}
            >
              {formatMoney(Math.abs(myBalance))}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {myBalance > 0
                ? 'You are owed in this book'
                : myBalance < 0
                  ? 'You owe in this book'
                  : 'All settled 🎉'}
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="shrink-0" disabled={exporting}>
                {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />} Share
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={shareAsImage}>
                <ImageIcon className="h-4 w-4" /> Share as image
              </DropdownMenuItem>
              <DropdownMenuItem onClick={shareAsPdf}>
                <FileText className="h-4 w-4" /> Save as PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={shareSummary}>
                <MessageCircle className="h-4 w-4" /> WhatsApp / text
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Owed to you / You still owe breakdown */}
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <div className="rounded-xl bg-background/50 border border-border/50 p-3">
            <div className="font-mono font-bold tabular text-lg text-positive">
              {formatMoney(owedToMeTotal)}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">Owed to you</div>
            {seeOwn && owedToMe.length > 0 && (
              <div className="mt-2.5 space-y-1.5 border-t border-border/40 pt-2">
                {owedToMe.map((x) => (
                  <div key={x.id} className="flex items-center justify-between gap-1.5 text-xs">
                    <span className="truncate text-muted-foreground">{name(x.id)}</span>
                    <span className="font-mono font-semibold tabular text-positive shrink-0">
                      {formatMoney(x.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-xl bg-background/50 border border-border/50 p-3">
            <div className="font-mono font-bold tabular text-lg text-negative">
              {formatMoney(iOweTotal)}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">You still owe</div>
            {seeOwn && iOwe.length > 0 && (
              <div className="mt-2.5 space-y-1.5 border-t border-border/40 pt-2">
                {iOwe.map((x) => (
                  <div key={x.id} className="flex items-center justify-between gap-1.5 text-xs">
                    <span className="truncate text-muted-foreground">{name(x.id)}</span>
                    <span className="font-mono font-semibold tabular text-negative shrink-0">
                      {formatMoney(x.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* Record a payment (incl. advance / extra) */}
      {maySettle && (
        <Button
          variant="outline"
          className="w-full h-11 font-semibold"
          onClick={() => onSettle({ fromId: data?.myMemberId ?? '', toId: '', amount: 0 })}
        >
          <Plus className="h-4 w-4" /> Record a payment
        </Button>
      )}

      {/* Settle-up plan (admins) */}
      {seeAll && (data?.settleUp?.length ?? 0) > 0 && (
        <div className="rounded-xl bg-card p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-sm font-semibold mb-2.5">
            <Sparkles className="h-4 w-4 text-primary" /> Settle up — fewest transfers
          </div>
          <div className="space-y-2">
            {data.settleUp.map((s, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="font-medium truncate">{nameOrYou(s.from)}</span>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="font-medium truncate">{nameOrYou(s.to)}</span>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <Amount paise={s.amount} className="text-sm" />
                  {maySettle && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => onSettle({ fromId: s.from, toId: s.to, amount: s.amount })}
                    >
                      <Handshake className="h-3 w-3" /> Settle
                    </Button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pairwise net strips */}
      {seeOwn ? (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground mb-2">
            {seeAll ? 'Who owes whom' : 'Your balances with others'}
          </h2>
          {(data?.pairs?.length ?? 0) === 0 ? (
            <div className="rounded-xl bg-card p-5 text-sm text-muted-foreground text-center shadow-sm">
              No balances between members yet.
            </div>
          ) : (
            <div className="space-y-2">
              {(data?.pairs ?? []).map((p) => {
                const key = `${p.a}-${p.b}`
                const open = openPair === key
                // debtor/creditor: net > 0 → a owes b
                const debtor = p.net > 0 ? p.a : p.b
                const creditor = p.net > 0 ? p.b : p.a
                const hist = open ? pairHistory(p.a, p.b) : []
                return (
                  <div key={key} className="rounded-xl bg-card shadow-sm overflow-hidden">
                    <button
                      className="w-full flex items-center justify-between p-3.5 text-left hover:bg-accent/40 transition-colors"
                      onClick={() => setOpenPair(open ? null : key)}
                      aria-expanded={open}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className="h-8 w-8 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                          style={{ backgroundColor: `${color(debtor)}26`, color: color(debtor) }}
                        >
                          {name(debtor)
                            .split(' ')
                            .map((w) => w[0])
                            .slice(0, 2)
                            .join('')
                            .toUpperCase()}
                        </span>
                        <div className="min-w-0 text-sm">
                          {p.net === 0 ? (
                            <span>
                              <span className="font-semibold">{nameOrYou(p.a)}</span> &{' '}
                              <span className="font-semibold">{nameOrYou(p.b)}</span> are settled
                            </span>
                          ) : (
                            <span>
                              <span className="font-semibold">{nameOrYou(debtor)}</span>{' '}
                              {isMe(debtor) ? 'owe' : 'owes'}{' '}
                              <span className="font-semibold">{nameOrYou(creditor)}</span>
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Amount
                          paise={Math.abs(p.net)}
                          className={
                            p.net === 0
                              ? 'text-muted-foreground'
                              : isMe(creditor)
                                ? 'text-positive'
                                : isMe(debtor)
                                  ? 'text-negative'
                                  : ''
                          }
                        />
                        <ChevronDown
                          className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
                        />
                      </div>
                    </button>
                    {open && (
                      <div className="border-t border-border/60 px-4 py-3 bg-accent/20 space-y-3">
                        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                          <div>
                            {nameOrYou(p.a)} owed from splits: <Amount paise={p.legAB} className="text-xs" />
                          </div>
                          <div>
                            {nameOrYou(p.b)} owed from splits: <Amount paise={p.legBA} className="text-xs" />
                          </div>
                          <div>
                            {nameOrYou(p.a)} paid: <Amount paise={p.paidAB} className="text-xs" />
                          </div>
                          <div>
                            {nameOrYou(p.b)} paid: <Amount paise={p.paidBA} className="text-xs" />
                          </div>
                        </div>
                        {p.net !== 0 && maySettle && (
                          <Button
                            size="sm"
                            className="w-full h-9 text-xs font-semibold"
                            onClick={() =>
                              onSettle({ fromId: debtor, toId: creditor, amount: Math.abs(p.net) })
                            }
                          >
                            <Handshake className="h-3.5 w-3.5" /> Settle {formatMoney(Math.abs(p.net))}
                          </Button>
                        )}
                        <div>
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground mb-1.5">
                            <History className="h-3.5 w-3.5" /> Settlement history
                          </div>
                          {hist.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No settlements between them yet.</p>
                          ) : (
                            <div className="space-y-1.5">
                              {hist.map((h) => (
                                <div key={h.id} className="flex items-center justify-between text-xs">
                                  <span className="text-muted-foreground">
                                    {h.status === 'CONFIRMED' ? '✅' : h.status === 'PENDING' ? '⏳' : '❌'}{' '}
                                    {nameOrYou(h.fromId)} → {nameOrYou(h.toId)} · {h.mode} · {fmtDate(h.date)}
                                    {h.status === 'PENDING' ? ' (pending)' : h.status === 'DECLINED' ? ' (declined)' : ''}
                                  </span>
                                  <Amount paise={h.amount} className="text-xs" />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      ) : (
        <div className="rounded-xl bg-card p-4 text-xs text-muted-foreground shadow-sm">
          As a Viewer you can see your own net balance. Ask a book admin for the full breakdown.
        </div>
      )}

      {/* Off-screen share card (rendered to PNG / PDF). Content is role-gated exactly like the visible tab. */}
      <div style={{ position: 'fixed', left: '-10000px', top: 0, pointerEvents: 'none' }} aria-hidden="true">
        <div
          ref={cardRef}
          style={{
            width: 480,
            background: '#ffffff',
            color: '#0b1220',
            padding: 28,
            fontFamily: 'Sora, system-ui, sans-serif',
            borderRadius: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>🏸 {data?.book?.name}</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                Balance summary · {todayIso ? fmtDate(todayIso) : ''}
              </div>
            </div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: '#15803d',
                border: '1px solid rgba(21,128,61,0.35)',
                borderRadius: 999,
                padding: '4px 10px',
              }}
            >
              Court Ledger
            </div>
          </div>

          <div style={{ height: 1, background: '#e2e8f0', margin: '18px 0' }} />

          {seeAll ? (
            <>
              <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: '#64748b', marginBottom: 10 }}>
                Member balances
              </div>
              {(data?.members ?? []).map((m) => {
                const b = data?.balances?.[m.id] ?? 0
                return (
                  <div
                    key={m.id}
                    style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', fontSize: 14 }}
                  >
                    <span style={{ fontWeight: 600 }}>{m.name}</span>
                    <span
                      style={{
                        fontFamily: 'JetBrains Mono, monospace',
                        fontWeight: 700,
                        color: b > 0 ? '#15803d' : b < 0 ? '#dc2626' : '#64748b',
                      }}
                    >
                      {b === 0 ? 'settled' : `${b > 0 ? 'receives' : 'owes'} ${formatMoney(Math.abs(b))}`}
                    </span>
                  </div>
                )
              })}
              {(data?.settleUp?.length ?? 0) > 0 && (
                <>
                  <div
                    style={{
                      fontSize: 11,
                      letterSpacing: 2,
                      textTransform: 'uppercase',
                      color: '#64748b',
                      margin: '16px 0 10px',
                    }}
                  >
                    Settle up — fewest transfers
                  </div>
                  {data.settleUp.map((s, i) => (
                    <div
                      key={i}
                      style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}
                    >
                      <span>
                        {name(s.from)} → {name(s.to)}
                      </span>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: '#0f766e' }}>
                        {formatMoney(s.amount)}
                      </span>
                    </div>
                  ))}
                </>
              )}
            </>
          ) : (
            <>
              <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: '#64748b', marginBottom: 8 }}>
                Your balance
              </div>
              <div
                style={{
                  fontSize: 26,
                  fontFamily: 'JetBrains Mono, monospace',
                  fontWeight: 700,
                  color: myBalance > 0 ? '#15803d' : myBalance < 0 ? '#dc2626' : '#0b1220',
                }}
              >
                {formatMoney(Math.abs(myBalance))}
                <span style={{ fontSize: 13, color: '#64748b', fontFamily: 'Sora, sans-serif', fontWeight: 400 }}>
                  {' '}
                  {myBalance > 0 ? 'to receive' : myBalance < 0 ? 'to pay' : 'all settled'}
                </span>
              </div>
              {seeOwn &&
                (data?.pairs ?? []).map((p) => {
                  const other = p.a === data.myMemberId ? p.b : p.a
                  const net = p.a === data.myMemberId ? p.net : -p.net
                  if (!net) return null
                  return (
                    <div
                      key={`${p.a}-${p.b}`}
                      style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', fontSize: 14, marginTop: 4 }}
                    >
                      <span>{net > 0 ? `You owe ${name(other)}` : `${name(other)} owes you`}</span>
                      <span
                        style={{
                          fontFamily: 'JetBrains Mono, monospace',
                          fontWeight: 700,
                          color: net > 0 ? '#dc2626' : '#15803d',
                        }}
                      >
                        {formatMoney(Math.abs(net))}
                      </span>
                    </div>
                  )
                })}
            </>
          )}

          <div style={{ height: 1, background: '#e2e8f0', margin: '18px 0 12px' }} />
          <div style={{ fontSize: 11, color: '#64748b', textAlign: 'center' }}>
            Generated with Court Ledger · shared expenses for sports groups
          </div>
        </div>
      </div>
    </div>
  )
}
