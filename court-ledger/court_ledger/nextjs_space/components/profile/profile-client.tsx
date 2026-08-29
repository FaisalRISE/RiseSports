'use client'

import { signOut } from 'next-auth/react'
import { useTheme } from 'next-themes'
import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { toast } from 'sonner'
import {
  Copy,
  Check,
  ImagePlus,
  Loader2,
  LogOut,
  Mail,
  Moon,
  QrCode,
  Save,
  Sun,
  Trash2,
  UserCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type Profile = {
  id: string
  email: string
  name: string
  firstName: string | null
  lastName: string | null
  mobile: string | null
  gender: string | null
  upiId: string | null
  qrImagePath: string | null
  qrImageUrl: string | null
}

const GENDERS = [
  { value: 'MALE', label: 'Male' },
  { value: 'FEMALE', label: 'Female' },
  { value: 'OTHER', label: 'Other' },
  { value: 'UNDISCLOSED', label: 'Prefer not to say' },
]

export function ProfileClient({ name, email }: { name: string; email: string }) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [copied, setCopied] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [mobile, setMobile] = useState('')
  const [gender, setGender] = useState('')
  const [upiId, setUpiId] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch('/api/profile')
        const d = await res.json().catch(() => ({}))
        if (!alive) return
        if (res.ok && d?.profile) {
          const p: Profile = d.profile
          setProfile(p)
          setFirstName(p.firstName ?? '')
          setLastName(p.lastName ?? '')
          setMobile(p.mobile ?? '')
          setGender(p.gender ?? '')
          setUpiId(p.upiId ?? '')
        }
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const saveDetails = async () => {
    if (saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, mobile, gender, upiId }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(d?.error ?? 'Could not save profile.')
        return
      }
      setProfile(d.profile)
      toast.success('Profile saved')
    } finally {
      setSaving(false)
    }
  }

  const copyUpi = async () => {
    const value = upiId.trim()
    if (!value) {
      toast.error('Add your UPI ID first.')
      return
    }
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast.success('UPI ID copied')
      setTimeout(() => setCopied(false), 1800)
    } catch {
      toast.error('Could not copy. Long-press to copy manually.')
    }
  }

  const onPickQr = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be under 5 MB.')
      return
    }
    setUploading(true)
    try {
      const pres = await fetch('/api/upload/presigned', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, contentType: file.type }),
      })
      const pd = await pres.json().catch(() => ({}))
      if (!pres.ok) {
        toast.error(pd?.error ?? 'Could not start upload.')
        return
      }
      const put = await fetch(pd.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      if (!put.ok) {
        toast.error('Upload failed. Please try again.')
        return
      }
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qrImagePath: pd.cloud_storage_path }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(d?.error ?? 'Could not save QR code.')
        return
      }
      setProfile(d.profile)
      toast.success('Payment QR uploaded')
    } finally {
      setUploading(false)
    }
  }

  const removeQr = async () => {
    setUploading(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qrImagePath: '' }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(d?.error ?? 'Could not remove QR code.')
        return
      }
      setProfile(d.profile)
      toast.success('QR code removed')
    } finally {
      setUploading(false)
    }
  }

  const displayName = profile?.name || name || 'Player'

  return (
    <div className="px-4 pt-6 space-y-5 pb-8">
      <header>
        <h1 className="text-xl font-bold tracking-tight">Profile</h1>
        <p className="text-xs text-muted-foreground">Your account, payment details and preferences.</p>
      </header>

      <div className="hero-card rounded-2xl p-5 flex items-center gap-4 shadow-lg">
        <span className="h-14 w-14 rounded-full bg-primary/20 text-primary flex items-center justify-center">
          <UserCircle className="h-8 w-8" />
        </span>
        <div className="min-w-0">
          <div className="font-semibold text-lg truncate">{displayName}</div>
          <div className="text-sm text-muted-foreground flex items-center gap-1.5 truncate">
            <Mail className="h-3.5 w-3.5 shrink-0" />
            <span suppressHydrationWarning>{email}</span>
          </div>
        </div>
      </div>

      {/* Personal details */}
      <section className="rounded-xl bg-card shadow-sm p-4 space-y-3">
        <h2 className="text-sm font-semibold">Personal details</h2>
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">First name</Label>
                <Input
                  placeholder="First name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Last name</Label>
                <Input
                  placeholder="Last name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Mobile number</Label>
                <Input
                  type="tel"
                  inputMode="tel"
                  placeholder="+91 98765 43210"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Gender</Label>
                <Select value={gender} onValueChange={setGender}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {GENDERS.map((g) => (
                      <SelectItem key={g.value} value={g.value}>
                        {g.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Email ID</Label>
              <Input value={email} readOnly disabled className="mt-1 opacity-70" />
              <p className="text-[11px] text-muted-foreground mt-1">Email is your login ID and cannot be changed.</p>
            </div>
            <Button className="w-full h-10 font-semibold" onClick={saveDetails} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save details
            </Button>
          </>
        )}
      </section>

      {/* Payment details */}
      <section className="rounded-xl bg-card shadow-sm p-4 space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-1.5">
          <QrCode className="h-4 w-4 text-primary" /> Payment details
        </h2>
        <div>
          <Label className="text-xs">UPI ID</Label>
          <div className="flex gap-2 mt-1">
            <Input
              placeholder="e.g. yourname@okhdfcbank"
              value={upiId}
              onChange={(e) => setUpiId(e.target.value)}
              className="font-mono"
            />
            <Button
              variant="outline"
              size="icon"
              className="shrink-0"
              onClick={copyUpi}
              aria-label="Copy UPI ID"
            >
              {copied ? <Check className="h-4 w-4 text-positive" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Tap the copy button to share your UPI ID quickly. Remember to Save details after editing.
          </p>
        </div>

        <div>
          <Label className="text-xs">Payment QR code</Label>
          {profile?.qrImageUrl ? (
            <div className="mt-2 space-y-2">
              <div className="relative aspect-square w-48 mx-auto rounded-xl overflow-hidden bg-white p-2 border border-border">
                <Image
                  src={profile.qrImageUrl}
                  alt="Your payment QR code"
                  fill
                  className="object-contain p-2"
                  unoptimized
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1 h-9 text-xs"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                  Replace
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 h-9 text-xs text-negative border-negative/30 hover:bg-negative-soft"
                  onClick={removeQr}
                  disabled={uploading}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="mt-2 w-full rounded-xl border border-dashed border-border hover:border-primary/60 transition-colors p-6 flex flex-col items-center gap-2 text-muted-foreground"
            >
              {uploading ? (
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              ) : (
                <ImagePlus className="h-6 w-6 text-primary" />
              )}
              <span className="text-xs font-medium">Upload your payment QR image</span>
              <span className="text-[11px]">PNG or JPG, up to 5 MB. Friends can scan it to pay you.</span>
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onPickQr}
            aria-label="Upload payment QR image"
          />
        </div>
      </section>

      {/* Preferences */}
      <div className="rounded-xl bg-card shadow-sm divide-y divide-border/60">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            {mounted && theme === 'dark' ? (
              <Moon className="h-4.5 w-4.5 text-secondary" />
            ) : (
              <Sun className="h-4.5 w-4.5 text-secondary" />
            )}
            <div>
              <div className="text-sm font-medium">Dark theme</div>
              <div className="text-xs text-muted-foreground">Lime & teal on navy — the classic look</div>
            </div>
          </div>
          {mounted && (
            <Switch
              checked={theme === 'dark'}
              onCheckedChange={(v) => setTheme(v ? 'dark' : 'light')}
              aria-label="Toggle dark theme"
            />
          )}
        </div>
        <div className="p-4">
          <Button
            variant="outline"
            className="w-full text-negative border-negative/30 hover:bg-negative-soft"
            onClick={() => signOut({ callbackUrl: '/login' })}
          >
            <LogOut className="h-4 w-4" /> Sign Out
          </Button>
        </div>
      </div>

      <p className="text-center text-xs text-muted-foreground pt-2">
        Court Ledger · shared expenses for sports groups
      </p>
    </div>
  )
}
