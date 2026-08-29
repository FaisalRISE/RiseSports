import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { LoginForm } from '@/components/auth/login-form'

export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  const session = await auth()
  if (session?.user) redirect('/overview')
  return <LoginForm />
}
