import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { SignupForm } from '@/components/auth/signup-form'

export const dynamic = 'force-dynamic'

export default async function SignupPage() {
  const session = await auth()
  if (session?.user) redirect('/overview')
  return <SignupForm />
}
