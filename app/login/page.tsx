'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function send(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })
    setBusy(false)
    if (error) setError(error.message)
    else setSent(true)
  }

  return (
    <main className="min-h-dvh bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-3xl font-black tracking-tight">YardLine</h1>
        <p className="mt-1 text-sm text-slate-400">
          Supply-side prospecting — metro Atlanta HD truck yards.
        </p>

        {sent ? (
          <div className="mt-8 rounded-lg border border-emerald-700 bg-emerald-950/40 p-4">
            <p className="font-semibold text-emerald-300">Check your email</p>
            <p className="mt-1 text-sm text-slate-300">
              We sent a sign-in link to <span className="font-mono">{email}</span>. Open it on this
              phone.
            </p>
          </div>
        ) : (
          <form onSubmit={send} className="mt-8 space-y-3">
            <label htmlFor="email" className="block text-sm font-medium text-slate-300">
              Work email
            </label>
            <input
              id="email"
              type="email"
              required
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-blue-600 px-4 py-3 text-base font-semibold disabled:opacity-50"
            >
              {busy ? 'Sending…' : 'Send magic link'}
            </button>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <p className="pt-2 text-xs text-slate-500">
              Access is limited to emails on the team roster. If the link doesn&apos;t arrive, ask
              an admin to add you to <code>allowed_emails</code>.
            </p>
          </form>
        )}
      </div>
    </main>
  )
}
