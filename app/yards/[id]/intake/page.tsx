'use client'

import { useCallback, useEffect, useRef, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import AuthGate from '@/components/AuthGate'
import { createClient } from '@/lib/supabase/client'
import { EMPTY_INTAKE, IntakeQuestions, answeredCount } from '@/components/IntakeQuestions'
import type { Intake, Yard } from '@/lib/types'

/**
 * Rep-facing discovery form. The eleven questions live in
 * components/IntakeQuestions so this and the self-serve form (/i/[token])
 * cannot drift — if the wording differs, the answers stop being comparable and
 * the census loses its meaning.
 */
function IntakeForm({ id }: { id: string }) {
  const router = useRouter()
  const [form, setForm] = useState<Omit<Intake, 'yard_id'>>(EMPTY_INTAKE)
  const [yard, setYard] = useState<Pick<Yard, 'name' | 'phone'> | null>(null)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [email, setEmail] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lsKey = `yardline:intake:${id}`

  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      const { data: sess } = await supabase.auth.getSession()
      setEmail(sess.session?.user.email ?? null)

      const [{ data: y }, { data: row }] = await Promise.all([
        supabase.from('yards').select('name, phone').eq('id', id).single(),
        supabase.from('intakes').select('*').eq('yard_id', id).maybeSingle(),
      ])
      setYard((y as Pick<Yard, 'name' | 'phone'>) ?? null)

      let base: Omit<Intake, 'yard_id'> = EMPTY_INTAKE
      if (row) base = { ...EMPTY_INTAKE, ...(row as Intake) }

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
      setLoaded(true)
    })()
  }, [id, lsKey])

  const persist = useCallback(
    async (next: Omit<Intake, 'yard_id'>) => {
      setStatus('saving')
      const supabase = createClient()
      // NEVER write completed_at/completed_by from the autosave path. This is a
      // full-row upsert, so including them would blank out a completed
      // discovery if a debounced save lands after `complete()` — which silently
      // drops the call from every /census metric.
      const { completed_at: _ca, completed_by: _cb, ...answers } = next
      void _ca
      void _cb
      const { error } = await supabase
        .from('intakes')
        .upsert({ yard_id: id, ...answers }, { onConflict: 'yard_id' })
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
    [id, lsKey]
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

  // Flush on backgrounding — phones suspend tabs without warning.
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
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    const supabase = createClient()
    const { error } = await supabase.from('intakes').upsert(
      {
        yard_id: id,
        ...form,
        completed_by: email,
        completed_at: new Date().toISOString(),
        completed_via: 'rep',
      },
      { onConflict: 'yard_id' }
    )
    if (error) {
      setStatus('error')
      return
    }
    await supabase.from('yards').update({ stage: 'discovery_done' }).eq('id', id)
    try {
      localStorage.removeItem(lsKey)
    } catch {
      /* ignore */
    }
    router.push(`/yards/${id}`)
  }

  if (!loaded) return <p className="p-4 text-sm text-slate-400">Loading…</p>

  const answered = answeredCount(form)
  const tel = yard?.phone?.replace(/[^\d+]/g, '')

  return (
    <main className="px-4 py-4">
      {/* The rep is on the call while filling this in — keep the number reachable. */}
      <div className="sticky top-[52px] z-10 -mx-4 mb-3 border-b border-slate-800 bg-slate-950/95 px-4 py-2 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-bold">{yard?.name}</p>
          {tel && (
            <a
              href={`tel:${tel}`}
              className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold"
            >
              Call {yard?.phone}
            </a>
          )}
          <span
            className={`shrink-0 text-xs ${
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
                ? 'Save failed'
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

      <p className="mb-3 text-xs text-slate-500">
        These answers are the whole point of the call — they tell us whether a live inventory feed
        is even possible in this market. Ask them in order; it takes about four minutes.
      </p>

      <IntakeQuestions form={form} set={set} audience="rep" />

      <button
        onClick={complete}
        className="mt-4 w-full rounded-xl bg-emerald-600 px-4 py-4 text-base font-bold active:bg-emerald-700"
      >
        Complete discovery
      </button>
      <p className="mt-2 pb-4 text-center text-xs text-slate-500">
        Answers save as you tap. Closing the app will not lose them.
      </p>
    </main>
  )
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return (
    <AuthGate>
      <IntakeForm id={id} />
    </AuthGate>
  )
}
