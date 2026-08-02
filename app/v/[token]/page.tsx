'use client'

import { useCallback, useEffect, useState, use } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

/**
 * Vendor-facing price tool. Public, token-authenticated, no login.
 *
 * This is the value we give a yard BEFORE asking for anything. The "price my
 * list" box is also the census's strongest instrument: a yard that pastes its
 * inventory to get a valuation has demonstrated it will hand over inventory —
 * revealed preference, which beats any survey answer about feed willingness.
 *
 * Pricing data is mirrored public listing FACTS from HeavyTruckParts.net. Every
 * comparable links back to its source. See SCRAPING_POLICY.md.
 */

type Stats = {
  n: number
  median: number | null
  p25: number | null
  p75: number | null
  min: number | null
  max: number | null
}
type Row = {
  year: number | null
  make: string | null
  model: string | null
  part_type: string | null
  price: number | null
  seller_city: string | null
  seller_state: string | null
  source_url: string
  is_available: boolean
}
type Facets = {
  makes: string[]
  families: string[]
  part_types: string[]
  total: number
  priced: number
  newest: string | null
}

const money = (n: number | null | undefined) =>
  n == null ? '—' : `$${Math.round(n).toLocaleString()}`

export default function VendorPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)

  const [yard, setYard] = useState<{ name: string; city: string | null } | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'invalid'>('loading')
  const [facets, setFacets] = useState<Facets | null>(null)

  const [make, setMake] = useState('')
  const [model, setModel] = useState('')
  const [partType, setPartType] = useState('')
  const [comps, setComps] = useState<{ stats: Stats; listings: Row[] } | null>(null)
  const [searching, setSearching] = useState(false)

  const [raw, setRaw] = useState('')
  const [matches, setMatches] = useState<
    Array<{ line: string; stats: Stats | null; sample: Row | null }> | null
  >(null)
  const [pricing, setPricing] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      const [{ data: y, error }, { data: f }] = await Promise.all([
        supabase.rpc('public_yard_by_token', { p_token: token }),
        supabase.rpc('price_facets'),
      ])
      if (error || !y) {
        setState('invalid')
        return
      }
      const payload = y as { yard: { name: string; city: string | null } }
      setYard(payload.yard)
      setFacets(f as Facets)
      setState('ready')
    })()
  }, [token])

  const search = useCallback(async () => {
    setSearching(true)
    const supabase = createClient()
    const { data } = await supabase.rpc('price_comps', {
      p_make: make || null,
      p_model: model || null,
      p_part_type: partType || null,
      p_limit: 25,
    })
    setComps(data as { stats: Stats; listings: Row[] })
    setSearching(false)
  }, [make, model, partType])

  /** Pull a make and a part-type hint out of a free-text inventory line. */
  function parseLine(line: string) {
    const upper = line.toUpperCase()
    const year = line.match(/\b(19|20)\d{2}\b/)?.[0]
    const foundMake = (facets?.makes ?? []).find((m) => upper.includes(m))
    const foundType = (facets?.part_types ?? [])
      .slice()
      .sort((a, b) => b.length - a.length)
      .find((p) => upper.includes(p.toUpperCase()))
    return { year: year ? parseInt(year, 10) : null, make: foundMake ?? null, partType: foundType ?? null }
  }

  async function priceList() {
    setPricing(true)
    setSaved(false)
    const supabase = createClient()
    const lines = raw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 40)

    const out: Array<{ line: string; stats: Stats | null; sample: Row | null }> = []
    for (const line of lines) {
      const p = parseLine(line)
      if (!p.make && !p.partType) {
        out.push({ line, stats: null, sample: null })
        continue
      }
      const { data } = await supabase.rpc('price_comps', {
        p_make: p.make,
        p_model: null,
        p_part_type: p.partType,
        p_year_min: p.year ? p.year - 3 : null,
        p_year_max: p.year ? p.year + 3 : null,
        p_limit: 1,
      })
      const r = data as { stats: Stats; listings: Row[] }
      out.push({ line, stats: r?.stats ?? null, sample: r?.listings?.[0] ?? null })
    }
    setMatches(out)
    setPricing(false)

    const matched = out.filter((m) => (m.stats?.n ?? 0) > 0).length
    await supabase.rpc('submit_vendor_inventory', {
      p_token: token,
      p_raw: raw,
      p_parsed: out.map((m) => ({ line: m.line, n: m.stats?.n ?? 0, median: m.stats?.median ?? null })),
      p_line_count: lines.length,
      p_matched_count: matched,
    })
    setSaved(true)
  }

  if (state === 'loading') return <main className="p-6 text-sm text-slate-400">Loading…</main>
  if (state === 'invalid') {
    return (
      <main className="min-h-dvh bg-slate-950 p-6 text-slate-100">
        <h1 className="text-2xl font-black">Link not valid</h1>
        <p className="mt-2 text-sm text-slate-400">This link expired or was mistyped.</p>
      </main>
    )
  }

  const total = matches?.reduce((s, m) => s + (m.stats?.median ?? 0), 0) ?? 0
  const matchedCount = matches?.filter((m) => (m.stats?.n ?? 0) > 0).length ?? 0

  return (
    <main className="min-h-dvh bg-slate-950 px-4 py-4 text-slate-100">
      <div className="mx-auto max-w-2xl pb-10">
        <p className="text-xs font-bold uppercase tracking-wide text-emerald-400">YardLine</p>
        <h1 className="mt-1 text-2xl font-black leading-tight">
          What your parts are selling for
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          {yard?.name}
          {yard?.city ? ` · ${yard.city}` : ''}
        </p>

        {/* ---------------- price lookup ---------------- */}
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-400">
            Look up a part
          </h2>
          <div className="grid grid-cols-3 gap-2">
            <input
              list="makes"
              value={make}
              onChange={(e) => setMake(e.target.value)}
              placeholder="Make"
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-3 text-base outline-none focus:border-emerald-500"
            />
            <datalist id="makes">
              {(facets?.makes ?? []).map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="Model"
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-3 text-base outline-none focus:border-emerald-500"
            />
            <input
              list="types"
              value={partType}
              onChange={(e) => setPartType(e.target.value)}
              placeholder="Part"
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-3 text-base outline-none focus:border-emerald-500"
            />
            <datalist id="types">
              {(facets?.part_types ?? []).map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>
          <button
            onClick={search}
            disabled={searching}
            className="mt-2 w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-bold disabled:opacity-50"
          >
            {searching ? 'Searching…' : 'Show comparable prices'}
          </button>

          {comps && (
            <div className="mt-3">
              {comps.stats.n > 0 ? (
                <>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      ['Median', comps.stats.median],
                      ['25th', comps.stats.p25],
                      ['75th', comps.stats.p75],
                      ['Listings', comps.stats.n],
                    ].map(([label, v], i) => (
                      <div key={String(label)} className="rounded-lg border border-slate-800 bg-slate-900 p-3">
                        <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
                        <p className="mt-0.5 text-lg font-black text-emerald-400">
                          {i === 3 ? v : money(v as number)}
                        </p>
                      </div>
                    ))}
                  </div>
                  <ul className="mt-3 space-y-1.5">
                    {comps.listings.map((l, i) => (
                      <li
                        key={i}
                        className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900 p-3 text-sm"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-semibold">
                            {[l.year, l.make, l.model, l.part_type].filter(Boolean).join(' ')}
                          </p>
                          <p className="truncate text-xs text-slate-500">
                            {[l.seller_city, l.seller_state].filter(Boolean).join(', ') || 'location n/a'}
                            {!l.is_available && ' · sold'}
                          </p>
                        </div>
                        <a
                          href={l.source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="shrink-0 font-mono font-bold text-emerald-400 underline-offset-2 hover:underline"
                        >
                          {money(l.price)}
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400">
                  Nothing in the index matches that yet. Try just a make, or just a part type.
                </p>
              )}
            </div>
          )}
        </section>

        {/* ---------------- price my list ---------------- */}
        <section className="mt-8">
          <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-slate-400">
            Price my list
          </h2>
          <p className="mb-2 text-xs text-slate-500">
            Paste up to 40 lines, one part each — e.g. &ldquo;2016 Kenworth T680 hood&rdquo;.
            Nothing is published; this is just to price your yard.
          </p>
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={7}
            placeholder={'2016 Kenworth T680 hood\n2014 Freightliner Cascadia transmission\n2018 Peterbilt 579 ECM'}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-3 font-mono text-sm outline-none focus:border-emerald-500"
          />
          <button
            onClick={priceList}
            disabled={pricing || !raw.trim()}
            className="mt-2 w-full rounded-lg bg-emerald-600 px-4 py-4 text-base font-bold disabled:opacity-50"
          >
            {pricing ? 'Pricing…' : 'Price my list'}
          </button>

          {matches && (
            <div className="mt-3">
              <div className="rounded-xl border border-emerald-800 bg-emerald-950/30 p-4">
                <p className="text-xs uppercase tracking-wide text-emerald-300">
                  Indicative value of matched lines
                </p>
                <p className="mt-1 text-3xl font-black text-emerald-400">{money(total)}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {matchedCount} of {matches.length} lines matched the index. Median of comparable
                  listings, not an offer.
                </p>
              </div>
              <ul className="mt-2 space-y-1.5">
                {matches.map((m, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900 p-3 text-sm"
                  >
                    <span className="min-w-0 truncate font-mono text-xs text-slate-300">{m.line}</span>
                    {m.stats && m.stats.n > 0 ? (
                      <span className="shrink-0 text-right">
                        <span className="font-bold text-emerald-400">{money(m.stats.median)}</span>
                        <span className="ml-2 text-xs text-slate-500">n={m.stats.n}</span>
                      </span>
                    ) : (
                      <span className="shrink-0 text-xs text-slate-600">no match</span>
                    )}
                  </li>
                ))}
              </ul>
              {saved && (
                <p className="mt-2 text-center text-xs text-slate-500">
                  Saved. We&apos;ll use this to size what a feed would be worth to you.
                </p>
              )}
            </div>
          )}
        </section>

        {/* ---------------- honest coverage ---------------- */}
        <section className="mt-8 rounded-xl border border-slate-800 bg-slate-900 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
            What this index covers
          </p>
          <p className="mt-1 text-sm leading-snug text-slate-300">
            {facets?.priced?.toLocaleString() ?? 0} priced listings collected from public
            HeavyTruckParts.net pages
            {facets?.newest ? ` as of ${new Date(facets.newest).toLocaleDateString()}` : ''}. This is
            a sample, not the whole market — treat medians with a low listing count as directional.
            Every price links back to its source listing.
          </p>
          <Link href={`/i/${token}`} className="mt-3 block text-sm font-semibold text-violet-400">
            Answer 11 questions about your yard →
          </Link>
        </section>
      </div>
    </main>
  )
}
