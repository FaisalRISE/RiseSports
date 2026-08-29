'use client'

import { useState } from 'react'
import { Check, X } from 'lucide-react'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Role } from '@/lib/finance'

type RoleSpec = {
  role: Role
  emoji: string
  label: string
  tagline: string
  granted: string[]
  restricted: string[]
}

const ROLE_SPECS: RoleSpec[] = [
  {
    role: 'PRIMARY_ADMIN',
    emoji: '👑',
    label: 'Primary Admin',
    tagline: 'Creator with full access across all features & settings',
    granted: [
      'Full creator control: delete or rename book',
      'Add, change roles or remove members',
      'Add & edit court bookings and payments',
      "View everyone's balances & who-owes-whom",
      'Export reports & share balance summaries',
    ],
    restricted: [],
  },
  {
    role: 'BOOK_ADMIN',
    emoji: '⭐',
    label: 'Book Admin',
    tagline: 'Trusted manager for members, entries & payments',
    granted: [
      'Add, change roles or remove members',
      'Add & edit court bookings and payments',
      "View everyone's balances & who-owes-whom",
      'Export reports & share balance summaries',
    ],
    restricted: ['Delete or rename the book (Primary Admin only)'],
  },
  {
    role: 'DATA_OPERATOR',
    emoji: '✏️',
    label: 'Data Operator',
    tagline: 'Can log activity and manage their own entries',
    granted: [
      'Add court bookings, expenses & payments',
      'Edit or delete entries they created',
      'See their own balance & dues with each member',
    ],
    restricted: [
      'Manage members or change roles',
      "View other members' pairwise balances",
      'Delete or rename the book',
    ],
  },
  {
    role: 'VIEWER',
    emoji: '👁️',
    label: 'Viewer',
    tagline: 'Read-only access to activity and their own net balance',
    granted: ['View entries & reports', 'See their own net balance'],
    restricted: [
      'Add or edit entries and payments',
      'See who owes whom (pairwise balances)',
      'Manage members, roles or book settings',
    ],
  },
]

export function RolesInfoSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const [active, setActive] = useState<Role>('PRIMARY_ADMIN')
  const spec = ROLE_SPECS.find((r) => r.role === active) ?? ROLE_SPECS[0]

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92dvh]">
        <DrawerHeader>
          <DrawerTitle>Roles & Permissions</DrawerTitle>
          <DrawerDescription>Court Ledger role hierarchy</DrawerDescription>
        </DrawerHeader>
        <div className="px-4 pb-8 space-y-4 overflow-y-auto">
          {/* Role tabs */}
          <div className="flex flex-wrap gap-1.5">
            {ROLE_SPECS.map((r) => (
              <button
                key={r.role}
                type="button"
                onClick={() => setActive(r.role)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors',
                  active === r.role
                    ? 'bg-primary/15 text-primary border-primary'
                    : 'bg-card text-muted-foreground border-border hover:border-primary/50'
                )}
                aria-pressed={active === r.role}
              >
                {r.emoji} {r.label}
              </button>
            ))}
          </div>

          {/* Role summary card */}
          <div className="rounded-xl bg-card shadow-sm p-4 flex items-center gap-3">
            <span className="h-11 w-11 rounded-xl bg-primary/15 flex items-center justify-center text-xl shrink-0">
              {spec.emoji}
            </span>
            <div className="min-w-0">
              <div className="font-bold">{spec.label}</div>
              <div className="text-xs text-muted-foreground">{spec.tagline}</div>
            </div>
          </div>

          {/* Granted */}
          <div>
            <div className="text-[11px] font-bold tracking-widest uppercase text-muted-foreground mb-2">
              Permissions granted
            </div>
            <div className="space-y-2">
              {spec.granted.map((g) => (
                <div key={g} className="rounded-xl bg-card shadow-sm p-3 flex items-center gap-2.5">
                  <span className="h-5 w-5 rounded-md bg-positive-soft text-positive flex items-center justify-center shrink-0">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-sm">{g}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Restricted */}
          {spec.restricted.length > 0 && (
            <div>
              <div className="text-[11px] font-bold tracking-widest uppercase text-muted-foreground mb-2">
                Restricted
              </div>
              <div className="space-y-2">
                {spec.restricted.map((r) => (
                  <div key={r} className="rounded-xl bg-card shadow-sm p-3 flex items-center gap-2.5 opacity-80">
                    <span className="h-5 w-5 rounded-md bg-negative-soft text-negative flex items-center justify-center shrink-0">
                      <X className="h-3.5 w-3.5" />
                    </span>
                    <span className="text-sm">{r}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Button className="w-full h-11 font-semibold" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
