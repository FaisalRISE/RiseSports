import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { BottomNav } from '@/components/bottom-nav'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect('/login')
  return (
    <div className="min-h-dvh max-w-[600px] mx-auto relative pb-24">
      {children}
      <BottomNav />
    </div>
  )
}
