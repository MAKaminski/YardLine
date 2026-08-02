'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import AuthGate from '@/components/AuthGate'
import { createClient } from '@/lib/supabase/client'
import { STAGE_COLOR, STAGE_LABEL, type Stage, type Yard } from '@/lib/types'

type DueRow = { yard_id: string; next_action: string | null; next_action_due: string }

function YardCard({ yard, badge }: { yard: Yard; badge?: string }) {
  return (
    <li className="rounded-xl border border-slate-800 bg-slate-900">
      <div className="flex items-stretch justify-between gap-3 p-3">
        <Link href={`/yards/${yard.id}`} className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: STAGE_COLOR[yard.stage as Stage] ?? '#64748b' }}
            />
            <p className="truncate font-semibold">{yard.name}</p>
          </div>
          <p className="mt-1 truncate text-sm text-slate-400">
            {[yard.city, yard.county && `${yard.county} Co.`].filter(Boolean).join(' · ') ||
              'Location unknown'}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded bg-slate-800 px-2 py-0.5 text-slate-300">
              {STAGE_LABEL[yard.stage as Stage] ?? yard.stage}
            </span>
            {yard.published_listing_count != null && (
              <span className="rounded bg-indigo-950 px-2 py-0.5 text-indigo-300">
                {yard.published_listing_count.toLocaleString()} listed
              </span>
            )}
            {badge && <span className="rounded bg-amber-950 px-2 py-0.5 text-amber-300">{badge}</span>}
          </div>
        </Link>

        {yard.phone ? (
          <a
            href={`tel:${yard.phone.replace(/[^\d+]/g, '')}`}
            className="flex shrink-0 items-center rounded-lg bg-emerald-600 px-5 text-sm font-bold active:bg-emerald-700"
          >
            Call
          </a>
        ) : (
          <span className="flex shrink-0 items-center rounded-lg bg-slate-800 px-3 text-xs text-slate-500">
            No phone
          </span>
        )}
      </div>
    </li>
  )
}

function Today() {
  const [due, setDue] = useState<Array<{ yard: Yard; action: DueRow }>>([])
  const [fresh, setFresh] = useState<Yard[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      const today = new Date().toISOString().slice(0, 10)

      const [{ data: acts }, { data: yards, error }] = await Promise.all([
        supabase
          .from('activities')
          .select('yard_id, next_action, next_action_due')
          .not('next_action_due', 'is', null)
          .lte('next_action_due', today)
          .order('next_action_due', { ascending: true }),
        supabase
          .from('yards')
          .select('*')
          .in('stage', ['new', 'attempted'])
          .order('published_listing_count', { ascending: false, nullsFirst: false })
          .limit(200),
      ])

      if (error) setErr(error.message)

      const dueIds = [...new Set((acts ?? []).map((a) => (a as DueRow).yard_id))]
      if (dueIds.length) {
        const { data: dueYards } = await supabase.from('yards').select('*').in('id', dueIds)
        const byId = new Map((dueYards ?? []).map((y) => [(y as Yard).id, y as Yard]))
        const seen = new Set<string>()
        setDue(
          (acts ?? [])
            .map((a) => ({ yard: byId.get((a as DueRow).yard_id)!, action: a as DueRow }))
            .filter((r) => {
              if (!r.yard || r.yard.stage === 'dead') return false
              if (seen.has(r.yard.id)) return false
              seen.add(r.yard.id)
              return true
            })
        )
      }

      setFresh((yards ?? []) as Yard[])
      setLoading(false)
    })()
  }, [])

  if (loading) return <p className="p-4 text-sm text-slate-400">Loading yards…</p>

  return (
    <main className="px-4 py-4">
      {err && (
        <p className="mb-3 rounded-lg border border-red-800 bg-red-950/50 p-3 text-sm text-red-300">
          {err}
        </p>
      )}

      {due.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-amber-400">
            Callbacks due ({due.length})
          </h2>
          <ul className="space-y-2">
            {due.map(({ yard, action }) => (
              <YardCard key={yard.id} yard={yard} badge={action.next_action ?? 'Callback'} />
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-slate-400">
          Call list ({fresh.length})
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          Biggest published inventory first — those yards decide whether this market is fragmented.
        </p>
        {fresh.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-center">
            <p className="font-semibold">No yards loaded yet</p>
            <p className="mt-1 text-sm text-slate-400">
              Run the seeder, then refresh.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {fresh.map((y) => (
              <YardCard key={y.id} yard={y} />
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

export default function HomePage() {
  return (
    <AuthGate>
      <Today />
    </AuthGate>
  )
}
