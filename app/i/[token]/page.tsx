'use client'

import { useCallback, useEffect, useRef, useState, use } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { EMPTY_INTAKE, IntakeQuestions, answeredCount } from '@/components/IntakeQuestions'
import type { Intake } from '@/lib/types'

/**
 * Self-serve census intake. Public, no login — the yard's only credential is
 * the token in the URL, validated server-side by submit_public_intake().
 *
 * This exists so a census row does not require a phone call. Every answer here
 * is stored with completed_via='self_serve' so /census can weigh it separately
 * from a rep-verified one.
 */
export default function PublicIntakePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)

  const [yard, setYard] = useState<{ id: string; name: string; city: string | null } | null>(null)
  const [form, setForm] = useState<Omit<Intake, 'yard_id'>>(EMPTY_INTAKE)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [state, setState] = useState<'loading' | 'ready' | 'invalid' | 'done'>('loading')
  const [email, setEmail] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lsKey = `yardline:public-intake:${token}`

  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      const { data, error } = await supabase.rpc('public_yard_by_token', { p_token: token })
      if (error || !data) {
        setState('invalid')
        return
      }
      const payload = data as {
        yard: { id: string; name: string; city: string | null }
        intake: Record<string, unknown> | null
      }
      setYard(payload.yard)

      let base: Omit<Intake, 'yard_id'> = EMPTY_INTAKE
      if (payload.intake) {
        const r = payload.intake as unknown as Intake
        base = { ...EMPTY_INTAKE, ...r }
      }
      try {
        const raw = localStorage.getItem(lsKey)
        if (raw) {
          const draft = JSON.parse(raw) as Record<string, unknown>
          base = {
            ...base,
            ...Object.fromEntries(
              Object.entries(draft).filter(([, v]) => v !== null && v !== undefined)
            ),
          } as Omit<Intake, 'yard_id'>
        }
      } catch {
        /* ignore a malformed draft */
      }
      setForm(base)
      setState('ready')
    })()
  }, [token, lsKey])

  const persist = useCallback(
    async (next: Omit<Intake, 'yard_id'>) => {
      setStatus('saving')
      const supabase = createClient()
      // Autosave NEVER passes p_complete. Completion is set once, by complete().
      const { error } = await supabase.rpc('submit_public_intake', {
        p_token: token,
        p_payload: next as unknown as Record<string, unknown>,
        p_complete: false,
      })
      if (error) {
        setStatus('error')
        return
      }
      setStatus('saved')
      try {
        localStorage.removeItem(lsKey)
      } catch {
        /* ignore */
      }
    },
    [token, lsKey]
  )

  function set<K extends keyof Omit<Intake, 'yard_id'>>(key: K, value: Intake[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value }
      try {
        localStorage.setItem(lsKey, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => persist(next), 600)
      return next
    })
  }

  useEffect(() => {
    function flush() {
      if (document.visibilityState === 'hidden') {
        try {
          localStorage.setItem(lsKey, JSON.stringify(form))
        } catch {
          /* ignore */
        }
      }
    }
    document.addEventListener('visibilitychange', flush)
    return () => document.removeEventListener('visibilitychange', flush)
  }, [form, lsKey])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  async function complete() {
    // Cancel the pending autosave so it cannot land after this write.
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    const supabase = createClient()
    const { error } = await supabase.rpc('submit_public_intake', {
      p_token: token,
      p_payload: { ...form, contact_email: email.trim() || null } as unknown as Record<string, unknown>,
      p_complete: true,
    })
    if (error) {
      setStatus('error')
      return
    }
    try {
      localStorage.removeItem(lsKey)
    } catch {
      /* ignore */
    }
    setState('done')
  }

  if (state === 'loading') {
    return <main className="p-6 text-sm text-slate-400">Loading…</main>
  }

  if (state === 'invalid') {
    return (
      <main className="min-h-dvh bg-slate-950 p-6 text-slate-100">
        <h1 className="text-2xl font-black">Link not valid</h1>
        <p className="mt-2 text-sm text-slate-400">
          This link has expired or was mistyped. Reply to the email you received and we&apos;ll send
          a fresh one.
        </p>
      </main>
    )
  }

  if (state === 'done') {
    return (
      <main className="min-h-dvh bg-slate-950 p-6 text-slate-100">
        <div className="mx-auto max-w-lg">
          <h1 className="text-2xl font-black">Thank you</h1>
          <p className="mt-2 text-slate-300">
            That&apos;s everything we needed. Nobody will cold-call you about this.
          </p>
          <Link
            href={`/v/${token}`}
            className="mt-6 block rounded-xl bg-emerald-600 px-4 py-4 text-center text-base font-bold"
          >
            See what your parts are selling for →
          </Link>
        </div>
      </main>
    )
  }

  const answered = answeredCount(form)

  return (
    <main className="min-h-dvh bg-slate-950 px-4 py-4 text-slate-100">
      <div className="mx-auto max-w-lg">
        <header className="mb-4">
          <p className="text-xs font-bold uppercase tracking-wide text-violet-400">YardLine</p>
          <h1 className="mt-1 text-xl font-black leading-tight">{yard?.name}</h1>
          <p className="mt-2 text-sm leading-snug text-slate-300">
            Eleven questions, about four minutes, no account needed. We&apos;re mapping how
            heavy-duty parts inventory actually moves in Georgia — what you tell us decides whether
            a live listing feed is worth building for yards like yours.
          </p>
          <Link
            href={`/v/${token}`}
            className="mt-3 block rounded-lg border border-emerald-800 bg-emerald-950/40 px-3 py-3 text-center text-sm font-semibold text-emerald-300"
          >
            First — see what your parts are selling for →
          </Link>
        </header>

        <div className="sticky top-0 z-10 -mx-4 mb-3 border-b border-slate-800 bg-slate-950/95 px-4 py-2 backdrop-blur">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">{answered}/10 answered</span>
            <span
              className={`text-xs ${
                status === 'error'
                  ? 'text-red-400'
                  : status === 'saving'
                    ? 'text-amber-400'
                    : 'text-emerald-400'
              }`}
            >
              {status === 'saving'
                ? 'Saving…'
                : status === 'error'
                  ? 'Save failed — retrying on next change'
                  : status === 'saved'
                    ? 'Saved'
                    : ''}
            </span>
          </div>
          <div className="mt-1 h-1 w-full rounded bg-slate-800">
            <div
              className="h-1 rounded bg-violet-500 transition-all"
              style={{ width: `${(answered / 10) * 100}%` }}
            />
          </div>
        </div>

        <IntakeQuestions form={form} set={set} audience="yard" />

        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900 p-4">
          <p className="text-sm font-bold">Where should we send the results?</p>
          <p className="mt-1 text-xs text-slate-500">Optional. We&apos;ll send the price summary, nothing else.</p>
          <input
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@yard.com"
            className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-base outline-none focus:border-violet-500"
          />
        </div>

        <button
          onClick={complete}
          className="mt-4 w-full rounded-xl bg-emerald-600 px-4 py-4 text-base font-bold active:bg-emerald-700"
        >
          Submit
        </button>
        <p className="mt-2 pb-8 text-center text-xs text-slate-500">
          Answers save as you tap. Closing this page will not lose them.
        </p>
      </div>
    </main>
  )
}
