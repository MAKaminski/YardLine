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
          {/* Print the digits. Reps on a desk headset dial by reading, not tapping. */}
          <p className="mt-1 truncate font-mono text-sm text-slate-300">
            {yard.phone ?? 'no phone on file'}
          </p>
          <p className="truncate text-xs text-slate-400">
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
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newCity, setNewCity] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [tick, setTick] = useState(0)
  const reload = () => setTick((t) => t + 1)

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
        // 'contacted' stays on the list: a call that went well is still open
        // work. Dropping it the moment a rep made progress hid the best leads.
        supabase
          .from('yards')
          .select('*')
          .in('stage', ['new', 'attempted', 'contacted'])
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
  }, [tick])

  const shown =
    typeFilter === 'all' ? fresh : fresh.filter((y) => y.yard_type === typeFilter)

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
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400">
            Call list ({shown.length})
          </h2>
          <button
            onClick={() => setAdding((v) => !v)}
            className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold"
          >
            {adding ? 'Cancel' : '+ Add yard'}
          </button>
        </div>

        {/* A rep who Googles a yard mid-morning must be able to keep it. Without
            this the tool caps you at whatever the seeder found. */}
        {adding && (
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              if (!newName.trim()) return
              const supabase = createClient()
              const { error } = await supabase.from('yards').insert({
                name: newName.trim(),
                phone: newPhone.trim() || null,
                city: newCity.trim() || null,
                state: 'GA',
                source: 'rep_manual',
                yard_type: 'hd_salvage',
                stage: 'new',
              })
              if (error) {
                setErr(error.message)
                return
              }
              setNewName('')
              setNewPhone('')
              setNewCity('')
              setAdding(false)
              reload()
            }}
            className="mb-3 space-y-2 rounded-xl border border-blue-800 bg-slate-900 p-3"
          >
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Yard name (required)"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-base outline-none focus:border-blue-500"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                inputMode="tel"
                placeholder="Phone"
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-base outline-none focus:border-blue-500"
              />
              <input
                value={newCity}
                onChange={(e) => setNewCity(e.target.value)}
                placeholder="City"
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-base outline-none focus:border-blue-500"
              />
            </div>
            <button type="submit" className="w-full rounded-lg bg-blue-600 px-3 py-3 text-sm font-bold">
              Add to call list
            </button>
          </form>
        )}

        {/* OEM franchise dealers do not push a salvage feed. Let a rep hide them. */}
        <div className="mb-3 flex gap-1.5">
          {[
            { k: 'all', label: `All (${fresh.length})` },
            { k: 'hd_salvage', label: `Salvage yards (${fresh.filter((y) => y.yard_type === 'hd_salvage').length})` },
            { k: 'oem_dealer', label: `OEM dealers (${fresh.filter((y) => y.yard_type === 'oem_dealer').length})` },
          ].map((t) => (
            <button
              key={t.k}
              onClick={() => setTypeFilter(t.k)}
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                typeFilter === t.k ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <p className="mb-3 text-xs text-slate-500">
          Biggest published inventory first — those yards decide whether this market is fragmented.
        </p>
        {shown.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-center">
            <p className="font-semibold">No yards loaded yet</p>
            <p className="mt-1 text-sm text-slate-400">
              Run the seeder, then refresh.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {shown.map((y) => (
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
