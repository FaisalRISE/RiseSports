import { auth } from '@/auth'
import { ProfileClient } from '@/components/profile/profile-client'

export const dynamic = 'force-dynamic'

export default async function ProfilePage() {
  const session = await auth()
  const user = session?.user as { name?: string | null; email?: string | null } | undefined
  return <ProfileClient name={user?.name ?? ''} email={user?.email ?? ''} />
}
