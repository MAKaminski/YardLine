'use client'

import { useCallback, useEffect, useRef, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import AuthGate from '@/components/AuthGate'
import { createClient } from '@/lib/supabase/client'
import type { Intake } from '@/lib/types'

/**
 * The eleven census questions. Wording is the measurement instrument — changing
 * it breaks comparability across calls. Do not reword without a migration plan.
 */
const INVENTORY_SIZE = ['<500', '500–2k', '2k–10k', '10k+', 'unknown']
const IMS_VENDORS = [
  'ITrack',
  'Checkmate/Car-Part',
  'Hollander Powerlink',
  'Pinnacle',
  'Spreadsheet',
  'Paper',
  'Other',
  'Unknown',
]
const PUBLISHES_WHERE = [
  'HeavyTruckParts.net',
  'TruckPartsInventory',
  'Own website',
  'eBay',
  'Facebook',
  'None',
]
const UPDATE_FREQUENCY = ['real-time', 'daily', 'weekly', 'rarely', 'never']
const TOP_FAMILIES = [
  'engines',
  'transmissions',
  'rears/differentials',
  'cabs',
  'hoods',
  'aftertreatment/DPF',
  'turbos',
  'axles/suspension',
  'electronics/ECMs',
  'other',
]
const BUYER_MIX = [
  'fleets direct',
  'independent repair shops',
  'other yards/brokers',
  'retail/walk-in',
  'mixed',
]
const FEED_WILLINGNESS = ['yes', 'maybe', 'no']

const EMPTY: Omit<Intake, 'yard_id'> = {
  completed_by: null,
  completed_at: null,
  inventory_size: null,
  ims_vendor: null,
  publishes_where: null,
  update_frequency: null,
  pct_availability_calls: null,
  top_families: null,
  buyer_mix: null,
  feed_willingness: null,
  feed_objection: null,
  exclusivity_constraint: null,
  rep_confidence: null,
}

function Card({
  n,
  prompt,
  hint,
  children,
}: {
  n: number
  prompt: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <p className="text-sm font-bold text-slate-100">
        <span className="mr-2 text-slate-500">{n}.</span>
        {prompt}
      </p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Chips({
  options,
  value,
  onChange,
}: {
  options: string[]
  value: string | null
  onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={`rounded-lg px-3 py-3 text-sm font-semibold ${
            value === o ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-300'
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  )
}

function MultiChips({
  options,
  value,
  onChange,
  max,
}: {
  options: string[]
  value: string[] | null
  onChange: (v: string[]) => void
  max?: number
}) {
  const sel = value ?? []
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = sel.includes(o)
        return (
          <button
            key={o}
            type="button"
            onClick={() => {
              if (on) onChange(sel.filter((s) => s !== o))
              else if (!max || sel.length < max) onChange([...sel, o])
            }}
            className={`rounded-lg px-3 py-3 text-sm font-semibold ${
              on ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-300'
            }`}
          >
            {o}
          </button>
        )
      })}
    </div>
  )
}

function IntakeForm({ id }: { id: string }) {
  const router = useRouter()
  const [form, setForm] = useState<Omit<Intake, 'yard_id'>>(EMPTY)
  const [yardName, setYardName] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [email, setEmail] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lsKey = `yardline:intake:${id}`

  // Load: server row first, then overlay any newer unsaved local draft.
  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      const { data: sess } = await supabase.auth.getSession()
      setEmail(sess.session?.user.email ?? null)

      const [{ data: y }, { data: row }] = await Promise.all([
        supabase.from('yards').select('name').eq('id', id).single(),
        supabase.from('intakes').select('*').eq('yard_id', id).maybeSingle(),
      ])
      setYardName((y as { name: string } | null)?.name ?? '')

      let base: Omit<Intake, 'yard_id'> = EMPTY
      if (row) {
        const r = row as Intake
        base = {
          completed_by: r.completed_by,
          completed_at: r.completed_at,
          inventory_size: r.inventory_size,
          ims_vendor: r.ims_vendor,
          publishes_where: r.publishes_where,
          update_frequency: r.update_frequency,
          pct_availability_calls: r.pct_availability_calls,
          top_families: r.top_families,
          buyer_mix: r.buyer_mix,
          feed_willingness: r.feed_willingness,
          feed_objection: r.feed_objection,
          exclusivity_constraint: r.exclusivity_constraint,
          rep_confidence: r.rep_confidence,
        }
      }

      try {
        const raw = localStorage.getItem(lsKey)
        if (raw) {
          const draft = JSON.parse(raw) as Omit<Intake, 'yard_id'>
          // Local draft wins for any field the server hasn't got — survives backgrounding.
          base = { ...base, ...Object.fromEntries(Object.entries(draft).filter(([, v]) => v !== null && v !== undefined)) }
        }
      } catch {
        /* ignore malformed draft */
      }

      setForm(base)
      setLoaded(true)
    })()
  }, [id, lsKey])

  const persist = useCallback(
    async (next: Omit<Intake, 'yard_id'>) => {
      setStatus('saving')
      const supabase = createClient()
      const { error } = await supabase
        .from('intakes')
        .upsert({ yard_id: id, ...next }, { onConflict: 'yard_id' })
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

  /** Every change: write localStorage immediately, debounce the network upsert. */
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

  async function complete() {
    const supabase = createClient()
    const payload = {
      yard_id: id,
      ...form,
      completed_by: email,
      completed_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('intakes').upsert(payload, { onConflict: 'yard_id' })
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

  const answered = [
    form.inventory_size,
    form.ims_vendor,
    form.publishes_where?.length ? 'y' : null,
    form.update_frequency,
    form.pct_availability_calls,
    form.top_families?.length ? 'y' : null,
    form.buyer_mix,
    form.feed_willingness,
    form.exclusivity_constraint,
    form.rep_confidence,
  ].filter((v) => v !== null && v !== undefined).length

  return (
    <main className="px-4 py-4">
      <div className="sticky top-[52px] z-10 -mx-4 mb-3 border-b border-slate-800 bg-slate-950/95 px-4 py-2 backdrop-blur">
        <div className="flex items-center justify-between">
          <p className="truncate text-sm font-bold">{yardName}</p>
          <span
            className={`text-xs ${
              status === 'error' ? 'text-red-400' : status === 'saving' ? 'text-amber-400' : 'text-emerald-400'
            }`}
          >
            {status === 'saving' ? 'Saving…' : status === 'error' ? 'Save failed — retrying on next change' : status === 'saved' ? 'Saved' : ''}
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
        These ten answers are the whole point of the call — they tell us whether a live inventory
        feed is even possible in this market. Ask them in order; it takes about four minutes.
      </p>

      <div className="space-y-3">
        <Card n={1} prompt="Roughly how many parts do you have on the yard right now?">
          <Chips options={INVENTORY_SIZE} value={form.inventory_size} onChange={(v) => set('inventory_size', v)} />
        </Card>

        <Card n={2} prompt="What do you use to track inventory?" hint="This is the single best predictor of whether they can send a feed.">
          <Chips options={IMS_VENDORS} value={form.ims_vendor} onChange={(v) => set('ims_vendor', v)} />
        </Card>

        <Card n={3} prompt="Where do you list inventory online today?" hint="Select all that apply.">
          <MultiChips
            options={PUBLISHES_WHERE}
            value={form.publishes_where}
            onChange={(v) => set('publishes_where', v)}
          />
        </Card>

        <Card n={4} prompt="How often do those listings get updated?">
          <Chips
            options={UPDATE_FREQUENCY}
            value={form.update_frequency}
            onChange={(v) => set('update_frequency', v)}
          />
        </Card>

        <Card
          n={5}
          prompt={'Out of 10 calls you take, how many are just "do you have X, what\'s it cost"?'}
          hint="0–10. High numbers mean a feed removes real pain for them."
        >
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 11 }, (_, i) => i).map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => set('pct_availability_calls', i)}
                className={`h-12 w-12 rounded-lg text-sm font-bold ${
                  form.pct_availability_calls === i ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-300'
                }`}
              >
                {i}
              </button>
            ))}
          </div>
        </Card>

        <Card n={6} prompt="Top 3 moving component families" hint="Pick up to 3.">
          <MultiChips
            options={TOP_FAMILIES}
            value={form.top_families}
            onChange={(v) => set('top_families', v)}
            max={3}
          />
        </Card>

        <Card n={7} prompt="Who buys from you most?">
          <Chips options={BUYER_MIX} value={form.buyer_mix} onChange={(v) => set('buyer_mix', v)} />
        </Card>

        <Card
          n={8}
          prompt="If a live inventory feed drove more inbound calls at no cost to you, would you push us one?"
        >
          <Chips
            options={FEED_WILLINGNESS}
            value={form.feed_willingness}
            onChange={(v) => set('feed_willingness', v)}
          />
        </Card>

        <Card n={9} prompt="If maybe/no — what's the hesitation?" hint="Their words, not yours. This list is the product roadmap.">
          <textarea
            value={form.feed_objection ?? ''}
            onChange={(e) => set('feed_objection', e.target.value)}
            rows={3}
            placeholder="Type what they actually said…"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-base outline-none focus:border-violet-500"
          />
        </Card>

        <Card n={10} prompt="Any contract or exclusivity stopping you from listing elsewhere?">
          <div className="flex gap-2">
            {[
              { l: 'Yes', v: true },
              { l: 'No', v: false },
            ].map((o) => (
              <button
                key={o.l}
                type="button"
                onClick={() => set('exclusivity_constraint', o.v)}
                className={`flex-1 rounded-lg px-3 py-3 text-sm font-semibold ${
                  form.exclusivity_constraint === o.v ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-300'
                }`}
              >
                {o.l}
              </button>
            ))}
          </div>
        </Card>

        <Card n={11} prompt="Your read: does this yard actually convert to a feed?" hint="1 = no chance, 5 = certain. Your gut, not theirs.">
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => set('rep_confidence', i)}
                className={`h-14 flex-1 rounded-lg text-lg font-bold ${
                  form.rep_confidence === i ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-300'
                }`}
              >
                {i}
              </button>
            ))}
          </div>
        </Card>
      </div>

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
