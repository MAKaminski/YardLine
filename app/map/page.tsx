'use client'

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import AuthGate from '@/components/AuthGate'
import { createClient } from '@/lib/supabase/client'
import {
  STAGES,
  STAGE_COLOR,
  STAGE_LABEL,
  milesBetween,
  type Stage,
  type Yard,
} from '@/lib/types'

const YardMap = dynamic(() => import('@/components/YardMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[55vh] items-center justify-center rounded-xl border border-slate-800 bg-slate-900 text-sm text-slate-500">
      Loading map…
    </div>
  ),
})

const ATL = { lat: 33.749, lng: -84.388 }

function MapView() {
  const [yards, setYards] = useState<Yard[]>([])
  const [loading, setLoading] = useState(true)
  const [stageFilter, setStageFilter] = useState<Stage[]>([])
  const [radius, setRadius] = useState(60)
  const [center, setCenter] = useState(ATL)
  const [located, setLocated] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('yards')
      .select('*')
      .then(({ data }) => {
        setYards((data ?? []) as Yard[])
        setLoading(false)
      })
  }, [])

  function useMyLocation() {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setCenter({ lat: p.coords.latitude, lng: p.coords.longitude })
        setLocated(true)
      },
      () => setLocated(false)
    )
  }

  const filtered = useMemo(() => {
    return yards
      .filter((y) => (stageFilter.length ? stageFilter.includes(y.stage) : true))
      .map((y) => ({
        y,
        dist:
          y.lat != null && y.lng != null
            ? milesBetween(center.lat, center.lng, y.lat, y.lng)
            : null,
      }))
      .filter((r) => (r.dist == null ? true : r.dist <= radius))
      .sort((a, b) => {
        if (a.dist == null) return 1
        if (b.dist == null) return -1
        return a.dist - b.dist
      })
  }, [yards, stageFilter, radius, center])

  function toggleStage(s: Stage) {
    setStageFilter((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))
  }

  if (loading) return <p className="p-4 text-sm text-slate-400">Loading map…</p>

  return (
    <main className="px-4 py-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          onClick={useMyLocation}
          className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold"
        >
          {located ? 'Centered on me' : 'Use my location'}
        </button>
        <label className="flex items-center gap-2 text-xs text-slate-400">
          Radius
          <select
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-xs"
          >
            {[10, 25, 40, 60, 100].map((r) => (
              <option key={r} value={r}>
                {r} mi
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {STAGES.map((s) => {
          const on = stageFilter.includes(s)
          return (
            <button
              key={s}
              onClick={() => toggleStage(s)}
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                on ? 'text-white' : 'bg-slate-800 text-slate-400'
              }`}
              style={on ? { background: STAGE_COLOR[s] } : undefined}
            >
              {STAGE_LABEL[s]}
            </button>
          )
        })}
      </div>

      <YardMap yards={filtered.map((f) => f.y)} center={center} />

      <section className="mt-4">
        <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-slate-400">
          Route my day ({filtered.length})
        </h2>
        <p className="mb-2 text-xs text-slate-500">Nearest first from your chosen center.</p>
        <ul className="space-y-2">
          {filtered.map(({ y, dist }) => (
            <li
              key={y.id}
              className="flex items-stretch gap-2 rounded-xl border border-slate-800 bg-slate-900 p-3"
            >
              <Link href={`/yards/${y.id}`} className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: STAGE_COLOR[y.stage] ?? '#64748b' }}
                  />
                  <p className="truncate font-semibold">{y.name}</p>
                </div>
                <p className="truncate text-xs text-slate-400">
                  {dist != null ? `${dist.toFixed(1)} mi · ` : 'distance unknown · '}
                  {y.city ?? 'city unknown'}
                </p>
              </Link>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                  [y.address, y.city, y.state, y.zip].filter(Boolean).join(', ') || y.name
                )}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center rounded-lg border border-slate-700 px-3 text-xs font-semibold text-slate-300"
              >
                Maps
              </a>
              {y.phone && (
                <a
                  href={`tel:${y.phone.replace(/[^\d+]/g, '')}`}
                  className="flex items-center rounded-lg bg-emerald-600 px-4 text-sm font-bold"
                >
                  Call
                </a>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}

export default function Page() {
  return (
    <AuthGate>
      <MapView />
    </AuthGate>
  )
}
