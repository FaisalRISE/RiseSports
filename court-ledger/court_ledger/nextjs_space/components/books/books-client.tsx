'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  Archive,
  ArchiveRestore,
  BookOpen,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from '@/components/ui/drawer'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Amount } from '@/components/amount'
import { fmtRelative, type BookSummary } from '@/lib/client-types'
import { isAdmin, canDeleteBook } from '@/lib/rbac'

export function BooksClient() {
  const [books, setBooks] = useState<BookSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [sheet, setSheet] = useState<'create' | 'rename' | null>(null)
  const [nameInput, setNameInput] = useState('')
  const [target, setTarget] = useState<BookSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<BookSummary | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/books')
      if (!res.ok) throw new Error('failed')
      const d = await res.json()
      setBooks(d?.books ?? [])
    } catch (e) {
      console.error('books load error', e)
      toast.error('Could not load books.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const createBook = async () => {
    const name = nameInput.trim()
    if (!name) return
    setBusy(true)
    try {
      const res = await fetch('/api/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(d?.error ?? 'Could not create book.')
      } else {
        toast.success(`“${name}” created`)
        setSheet(null)
        setNameInput('')
        await load()
      }
    } finally {
      setBusy(false)
    }
  }

  const renameBook = async () => {
    if (!target) return
    const name = nameInput.trim()
    if (!name) return
    setBusy(true)
    try {
      const res = await fetch(`/api/books/${target.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) toast.error(d?.error ?? 'Could not rename book.')
      else {
        toast.success('Book renamed')
        setSheet(null)
        await load()
      }
    } finally {
      setBusy(false)
    }
  }

  const setArchived = async (b: BookSummary, archived: boolean) => {
    const res = await fetch(`/api/books/${b.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived }),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) toast.error(d?.error ?? 'Could not update book.')
    else {
      toast.success(archived ? 'Book archived' : 'Book restored')
      await load()
    }
  }

  const deleteBook = async () => {
    if (!confirmDelete) return
    const res = await fetch(`/api/books/${confirmDelete.id}`, { method: 'DELETE' })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) toast.error(d?.error ?? 'Could not delete book.')
    else {
      toast.success('Book deleted')
      await load()
    }
    setConfirmDelete(null)
  }

  const q = query.toLowerCase()
  const active = books.filter((b) => !b.archived && b.name.toLowerCase().includes(q))
  const archived = books.filter((b) => b.archived && b.name.toLowerCase().includes(q))

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  const BookRow = ({ b, i }: { b: BookSummary; i: number }) => (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: i * 0.03 }}
      className="rounded-xl bg-card shadow-sm hover:shadow-md transition-shadow"
    >
      <div className="flex items-center justify-between p-3.5">
        <Link href={`/books/${b.id}`} className="flex items-center gap-3 flex-1 min-w-0">
          <span className="h-10 w-10 rounded-lg bg-primary/15 text-primary flex items-center justify-center shrink-0">
            <BookOpen className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{b.name}</div>
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Users className="h-3 w-3" /> {b.memberCount} · {b.entryCount} entries · {fmtRelative(b.updatedAt)}
            </div>
          </div>
        </Link>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          <Amount paise={b.myBalance} signed className="text-sm mr-1" />
          {isAdmin(b.myRole) && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground"
                aria-label="Rename book"
                onClick={() => {
                  setTarget(b)
                  setNameInput(b.name)
                  setSheet('rename')
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground"
                aria-label={b.archived ? 'Restore book' : 'Archive book'}
                onClick={() => setArchived(b, !b.archived)}
              >
                {b.archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
              </Button>
            </>
          )}
          {canDeleteBook(b.myRole) && b.archived && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-negative"
              aria-label="Delete book"
              onClick={() => setConfirmDelete(b)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  )

  return (
    <div className="px-4 pt-6 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Books</h1>
          <p className="text-xs text-muted-foreground">One book per group, season, or pool.</p>
        </div>
        <Button
          onClick={() => {
            setNameInput('')
            setSheet('create')
          }}
          className="font-semibold"
        >
          <Plus className="h-4 w-4" /> New Book
        </Button>
      </header>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by book name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {active.length === 0 && archived.length === 0 ? (
        <div className="rounded-2xl hero-card p-8 text-center">
          <BookOpen className="h-10 w-10 text-primary mx-auto mb-3" />
          <h2 className="font-semibold mb-1">No books yet</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Create a book for your group — e.g. “Badminton Tuesdays” — and start logging court bookings.
          </p>
          <Button
            onClick={() => {
              setNameInput('')
              setSheet('create')
            }}
          >
            <Plus className="h-4 w-4" /> Create your first book
          </Button>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {active.map((b, i) => (
              <BookRow key={b.id} b={b} i={i} />
            ))}
          </div>
          {archived.length > 0 && (
            <div className="pt-2">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
                <Archive className="h-3.5 w-3.5" /> Archived
              </h2>
              <div className="space-y-2 opacity-70">
                {archived.map((b, i) => (
                  <BookRow key={b.id} b={b} i={i} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Create / Rename sheet */}
      <Drawer open={sheet !== null} onOpenChange={(o) => !o && setSheet(null)}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{sheet === 'create' ? 'New Book' : 'Rename Book'}</DrawerTitle>
            <DrawerDescription>
              {sheet === 'create'
                ? 'Name your group ledger — you can add members next.'
                : 'Give this book a new name.'}
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-8 space-y-3">
            <Input
              placeholder="e.g. Badminton Tuesdays"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') sheet === 'create' ? createBook() : renameBook()
              }}
              autoFocus
            />
            <Button
              className="w-full font-semibold"
              disabled={busy || !nameInput.trim()}
              onClick={() => (sheet === 'create' ? createBook() : renameBook())}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {sheet === 'create' ? 'Create Book' : 'Save Name'}
            </Button>
          </div>
        </DrawerContent>
      </Drawer>

      {/* Delete confirm */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{confirmDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the book with all its entries and payments. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteBook} className="bg-destructive text-destructive-foreground">
              Delete forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
