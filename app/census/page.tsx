'use client'

import { useEffect, useState } from 'react'
import AuthGate from '@/components/AuthGate'
import { createClient } from '@/lib/supabase/client'
import { FEEDABLE_IMS, type Intake, type Yard } from '@/lib/types'
import HTP from '@/data/htp-concentration.json'

function pct(n: number, d: number) {
  if (!d) return 0
  return Math.round((100 * n) / d)
}

function Tile({
  label,
  value,
  sub,
  tone = 'slate',
}: {
  label: string
  value: string
  sub?: string
  tone?: 'slate' | 'good' | 'warn' | 'bad'
}) {
  const ring = {
    slate: 'border-slate-800',
    good: 'border-emerald-800',
    warn: 'border-amber-800',
    bad: 'border-red-800',
  }[tone]
  const text = {
    slate: 'text-slate-100',
    good: 'text-emerald-400',
    warn: 'text-amber-400',
    bad: 'text-red-400',
  }[tone]
  return (
    <div className={`rounded-xl border ${ring} bg-slate-900 p-4`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-black ${text}`}>{value}</p>
      {sub && <p className="mt-1 text-xs leading-snug text-slate-500">{sub}</p>}
    </div>
  )
}

function Census() {
  const [yards, setYards] = useState<Yard[]>([])
  const [intakes, setIntakes] = useState<Intake[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      const [{ data: y }, { data: i }] = await Promise.all([
        supabase.from('yards').select('*'),
        supabase.from('intakes').select('*'),
      ])
      setYards((y ?? []) as Yard[])
      setIntakes((i ?? []) as Intake[])
      setLoading(false)
    })()
  }, [])

  if (loading) return <p className="p-4 text-sm text-slate-400">Loading census…</p>

  const total = yards.length
  const contacted = yards.filter((y) =>
    ['contacted', 'discovery_done', 'feed_agreed', 'live'].includes(y.stage)
  ).length

  const done = intakes.filter((i) => i.completed_at)
  const feedable = done.filter((i) => i.ims_vendor && FEEDABLE_IMS.includes(i.ims_vendor)).length
  const manual = done.filter((i) => ['Spreadsheet', 'Paper'].includes(i.ims_vendor ?? '')).length

  const onlineNow = done.filter(
    (i) => (i.publishes_where ?? []).filter((p) => p !== 'None').length > 0
  ).length

  const willing = {
    yes: done.filter((i) => i.feed_willingness === 'yes').length,
    maybe: done.filter((i) => i.feed_willingness === 'maybe').length,
    no: done.filter((i) => i.feed_willingness === 'no').length,
  }

  const signed = yards.filter((y) => ['feed_agreed', 'live'].includes(y.stage)).length

  // Concentration across the yards we have identified.
  const counts = yards
    .map((y) => y.published_listing_count ?? 0)
    .filter((n) => n > 0)
    .sort((a, b) => b - a)
  const listingTotal = counts.reduce((s, n) => s + n, 0)
  const top20 = counts.slice(0, 20).reduce((s, n) => s + n, 0)
  const concentration = pct(top20, listingTotal)

  const objections = done
    .filter((i) => (i.feed_objection ?? '').trim().length > 0)
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))

  return (
    <main className="px-4 py-4">
      <h1 className="text-xl font-black">Census</h1>
      <p className="mt-1 text-xs text-slate-500">
        Does HD yard inventory exist across many independent sellers, and can it be reached as a
        live feed? These numbers answer that — not the pipeline.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Tile
          label="Coverage"
          value={`${contacted}/${total}`}
          sub={`${pct(contacted, total)}% of identified yards contacted`}
        />
        <Tile
          label="Feedable"
          value={done.length ? `${pct(feedable, done.length)}%` : '—'}
          tone={done.length && pct(feedable, done.length) < 40 ? 'bad' : 'good'}
          sub={
            done.length
              ? `${feedable} on a real IMS vs ${manual} on spreadsheet/paper. This is the ceiling on live-feed supply.`
              : 'No completed discoveries yet.'
          }
        />
        <Tile
          label="Already online"
          value={done.length ? `${pct(onlineNow, done.length)}%` : '—'}
          sub={`${onlineNow} of ${done.length} publish somewhere today`}
        />
        <Tile
          label="Signed feeds"
          value={String(signed)}
          tone={signed > 0 ? 'good' : 'slate'}
          sub="Yards at feed_agreed or live"
        />
        <Tile
          label="Feed willingness"
          value={`${willing.yes} / ${willing.maybe} / ${willing.no}`}
          sub="yes / maybe / no"
        />
        <Tile
          label="Concentration"
          value={listingTotal ? `${concentration}%` : '—'}
          tone={concentration > 70 ? 'bad' : 'good'}
          sub={
            listingTotal
              ? `Top-20 share of ${listingTotal.toLocaleString()} published listings across ${counts.length} yards.`
              : 'No published listing counts yet.'
          }
        />
      </div>

      <div
        className={`mt-3 rounded-xl border p-4 ${
          concentration > 70 ? 'border-red-800 bg-red-950/30' : 'border-emerald-800 bg-emerald-950/30'
        }`}
      >
        <p className="text-xs font-bold uppercase tracking-wide text-slate-300">
          How to read concentration
        </p>
        <p className="mt-1 text-sm leading-snug text-slate-300">
          &gt;70% means we are reselling one incumbent&apos;s index, not aggregating a market.
        </p>
      </div>

      {/* Measured from the incumbent's own public sitemap.
          scripts/htp-listing-counts.ts — see data/htp-concentration.json.
          Seller identity verified against live item pages: the URL's account id
          is the corporate parent and the branch id is one of its yards. */}
      <div className="mt-3 rounded-xl border border-red-800 bg-red-950/30 p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-red-300">
          Incumbent index — measured 2026-08-02
        </p>
        <p className="mt-2 text-3xl font-black text-red-400">{HTP.top20_account_share_pct}%</p>
        <p className="text-xs text-slate-400">top-20 corporate share of the whole index</p>
        <p className="mt-2 text-sm leading-snug text-slate-300">
          HeavyTruckParts.net publishes{' '}
          <strong>{HTP.total_listings.toLocaleString()}</strong> listings from{' '}
          <strong>{HTP.corporate_accounts}</strong> corporate sellers across{' '}
          <strong>{HTP.seller_locations}</strong> yard locations. One company holds{' '}
          <strong>{HTP.top1_account_share_pct}%</strong> of it; the top five hold{' '}
          <strong>{HTP.top5_account_share_pct}%</strong>.
        </p>
        <p className="mt-2 text-sm font-semibold leading-snug text-red-300">
          At {HTP.top20_account_share_pct}% this is not a fragmented market. Aggregating this index
          means reselling a handful of large recyclers — chiefly LKQ and Vander Haag&apos;s.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Counted from the site&apos;s own public sitemap; seller identity confirmed against live
          item pages. Only 6 of those {HTP.corporate_accounts} sellers list a Georgia location,
          which is why local discovery matters more than the directory.
        </p>
      </div>

      <section className="mt-6">
        <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-slate-400">
          Feed objections, verbatim ({objections.length})
        </h2>
        <p className="mb-2 text-xs text-slate-500">These sentences are the product roadmap.</p>
        {objections.length === 0 ? (
          <p className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-500">
            None recorded yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {objections.map((o, idx) => (
              <li key={idx} className="rounded-lg border border-slate-800 bg-slate-900 p-3">
                <p className="text-sm text-slate-200">&ldquo;{o.feed_objection}&rdquo;</p>
                <p className="mt-1 text-xs text-slate-500">
                  {o.feed_willingness ?? 'unknown'} · {o.ims_vendor ?? 'IMS unknown'} ·{' '}
                  {o.completed_at ? new Date(o.completed_at).toLocaleDateString() : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

export default function Page() {
  return (
    <AuthGate>
      <Census />
    </AuthGate>
  )
}
