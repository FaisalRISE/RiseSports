'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, Plus, ShieldCheck } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { canAddEntries } from '@/lib/rbac'
import type { BookDetail } from '@/lib/client-types'
import type { ActivityLite } from '@/lib/finance'
import { EntriesTab } from './entries-tab'
import { BalancesTab } from './balances-tab'
import { MembersTab } from './members-tab'
import { ReportsTab } from './reports-tab'
import { ActivitySheet } from './activity-sheet'
import { PaymentSheet, type PaymentPrefill } from './payment-sheet'
import { RolesInfoSheet } from './roles-info'

export function BookDetailClient({ bookId }: { bookId: string }) {
  const [data, setData] = useState<BookDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activitySheet, setActivitySheet] = useState<{ open: boolean; edit?: ActivityLite | null; duplicate?: ActivityLite | null }>({ open: false })
  const [paymentSheet, setPaymentSheet] = useState<PaymentPrefill | null>(null)
  const [rolesOpen, setRolesOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/books/${bookId}`)
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(d?.error ?? 'Could not load this book.')
        return
      }
      setData(d)
      setError(null)
    } catch (e) {
      console.error('book load error', e)
      setError('Could not load this book.')
    } finally {
      setLoading(false)
    }
  }, [bookId])

  useEffect(() => {
    load()
  }, [load])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="px-5 pt-10 text-center space-y-3">
        <p className="text-sm text-muted-foreground">{error ?? 'Book not found.'}</p>
        <Button asChild variant="outline" size="sm">
          <Link href="/books">Back to books</Link>
        </Button>
      </div>
    )
  }

  const mayAdd = canAddEntries(data.myRole)

  return (
    <div className="pt-4">
      <header className="px-4 flex items-center gap-2 mb-3">
        <Button asChild variant="ghost" size="icon" className="h-9 w-9 shrink-0" aria-label="Back to books">
          <Link href="/books">
            <ArrowLeft className="h-4.5 w-4.5" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold tracking-tight truncate">{data.book?.name}</h1>
          <p className="text-xs text-muted-foreground">
            {data.members?.length ?? 0} members{data.book?.archived ? ' · archived' : ''}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 text-secondary"
          onClick={() => setRolesOpen(true)}
          aria-label="Roles and permissions"
        >
          <ShieldCheck className="h-5 w-5" />
        </Button>
      </header>

      <Tabs defaultValue="entries" className="w-full">
        <TabsList className="mx-4 grid grid-cols-4 w-[calc(100%-2rem)]">
          <TabsTrigger value="entries">Entries</TabsTrigger>
          <TabsTrigger value="balances">Balances</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>
        <TabsContent value="entries" className="px-4 pt-3">
          <EntriesTab
            data={data}
            reload={load}
            onEdit={(a) => setActivitySheet({ open: true, edit: a })}
            onDuplicate={(a) => setActivitySheet({ open: true, duplicate: a })}
          />
        </TabsContent>
        <TabsContent value="balances" className="px-4 pt-3">
          <BalancesTab data={data} onSettle={(p) => setPaymentSheet(p)} reload={load} />
        </TabsContent>
        <TabsContent value="members" className="px-4 pt-3">
          <MembersTab data={data} reload={load} />
        </TabsContent>
        <TabsContent value="reports" className="px-4 pt-3">
          <ReportsTab data={data} />
        </TabsContent>
      </Tabs>

      {mayAdd && (
        <Button
          className="fixed bottom-20 right-[max(1rem,calc(50%-300px+1rem))] z-30 h-13 rounded-full shadow-lg font-semibold px-5"
          onClick={() => setActivitySheet({ open: true })}
          aria-label="Add entry"
        >
          <Plus className="h-5 w-5" /> Add Entry
        </Button>
      )}

      <ActivitySheet
        open={activitySheet.open}
        onOpenChange={(o) => !o && setActivitySheet({ open: false })}
        data={data}
        edit={activitySheet.edit ?? null}
        duplicate={activitySheet.duplicate ?? null}
        onSaved={async () => {
          setActivitySheet({ open: false })
          await load()
          toast.success('Entry saved')
        }}
      />

      <RolesInfoSheet open={rolesOpen} onOpenChange={setRolesOpen} />

      <PaymentSheet
        prefill={paymentSheet}
        onOpenChange={(o) => !o && setPaymentSheet(null)}
        data={data}
        onSaved={async () => {
          setPaymentSheet(null)
          await load()
        }}
      />
    </div>
  )
}
