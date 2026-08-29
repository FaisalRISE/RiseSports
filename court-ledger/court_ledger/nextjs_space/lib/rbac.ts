import type { Role } from '@/lib/finance'

export const ROLE_LABELS: Record<Role, string> = {
  PRIMARY_ADMIN: 'Primary Admin',
  BOOK_ADMIN: 'Book Admin',
  DATA_OPERATOR: 'Data Operator',
  VIEWER: 'Viewer',
}

export function isAdmin(role?: Role | null): boolean {
  return role === 'PRIMARY_ADMIN' || role === 'BOOK_ADMIN'
}

export function canAddEntries(role?: Role | null): boolean {
  return role === 'PRIMARY_ADMIN' || role === 'BOOK_ADMIN' || role === 'DATA_OPERATOR'
}

export function canManageMembers(role?: Role | null): boolean {
  return isAdmin(role)
}

export function canManageBookSettings(role?: Role | null): boolean {
  return isAdmin(role)
}

export function canDeleteBook(role?: Role | null): boolean {
  return role === 'PRIMARY_ADMIN'
}

/** Can this role see ALL pairwise balances (who owes whom)? */
export function canSeeAllBalances(role?: Role | null): boolean {
  return isAdmin(role)
}

/** Can this role see their own pairwise balances (who they owe / who owes them)? */
export function canSeeOwnPairs(role?: Role | null): boolean {
  return isAdmin(role) || role === 'DATA_OPERATOR'
}

export function canEditEntry(
  role: Role | null | undefined,
  entryCreatedByUserId: string | null | undefined,
  userId: string
): boolean {
  if (isAdmin(role)) return true
  if (role === 'DATA_OPERATOR') return entryCreatedByUserId === userId
  return false
}

export function canDeleteEntry(
  role: Role | null | undefined,
  entryCreatedByUserId: string | null | undefined,
  userId: string
): boolean {
  if (isAdmin(role)) return true
  if (role === 'DATA_OPERATOR') return entryCreatedByUserId === userId
  return false
}

export const MEMBER_COLORS = [
  '#a3e635',
  '#2dd4bf',
  '#38bdf8',
  '#c084fc',
  '#fb7185',
  '#fbbf24',
  '#fb923c',
  '#72BF78',
]

export function pickColor(index: number): string {
  return MEMBER_COLORS[index % MEMBER_COLORS.length] ?? '#a3e635'
}
