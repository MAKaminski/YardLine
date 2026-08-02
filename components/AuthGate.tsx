'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

const TABS = [
  { href: '/', label: 'Today' },
  { href: '/map', label: 'Map' },
  { href: '/census', label: 'Census' },
]

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [email, setEmail] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user.email ?? null)
      setReady(true)
      if (!data.session) router.replace('/login')
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user.email ?? null)
      if (!session) router.replace('/login')
    })
    return () => sub.subscription.unsubscribe()
  }, [router])

  if (!ready) {
    return <div className="p-6 text-sm text-slate-400">Loading…</div>
  }
  if (!email) return null

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100 pb-20">
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/95 backdrop-blur">
        <div className="flex items-center justify-between px-4 py-3">
          <Link href="/" className="text-lg font-black tracking-tight">
            YardLine
          </Link>
          <span className="truncate text-xs text-slate-500">{email}</span>
        </div>
      </header>

      {children}

      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 border-t border-slate-800 bg-slate-900">
        {TABS.map((t) => {
          const active = pathname === t.href
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`py-3 text-center text-sm font-semibold ${
                active ? 'text-blue-400' : 'text-slate-400'
              }`}
            >
              {t.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
