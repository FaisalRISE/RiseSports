'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, BookOpen, UserCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

const ITEMS = [
  { href: '/overview', label: 'Home', icon: Home },
  { href: '/books', label: 'Books', icon: BookOpen },
  { href: '/profile', label: 'Profile', icon: UserCircle },
]

export function BottomNav() {
  const pathname = usePathname() ?? ''
  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[600px] z-40 border-t border-border bg-background/85 backdrop-blur-lg">
      <div className="grid grid-cols-3">
        {ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/')
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors',
                active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className={cn('h-5 w-5', active && 'drop-shadow-[0_0_6px_hsl(var(--primary)/0.5)]')} />
              {item.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
