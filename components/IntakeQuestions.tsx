'use client'

import type { Intake } from '@/lib/types'

/**
 * The eleven census questions, shared by the rep form (/yards/[id]/intake) and
 * the self-serve form (/i/[token]).
 *
 * Wording and answer vocabularies ARE the measurement instrument. If the two
 * surfaces drift apart the answers stop being comparable, so both render from
 * this one file. Do not reword without a migration plan.
 */

export const INVENTORY_SIZE = ['<500', '500–2k', '2k–10k', '10k+', 'unknown']
export const IMS_VENDORS = [
  'ITrack',
  'Checkmate/Car-Part',
  'Hollander Powerlink',
  'Pinnacle',
  'Spreadsheet',
  'Paper',
  'Other',
  'Unknown',
]
export const PUBLISHES_WHERE = [
  'HeavyTruckParts.net',
  'TruckPartsInventory',
  'Own website',
  'eBay',
  'Facebook',
  'None',
]
export const UPDATE_FREQUENCY = ['real-time', 'daily', 'weekly', 'rarely', 'never']
export const TOP_FAMILIES = [
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
export const BUYER_MIX = [
  'fleets direct',
  'independent repair shops',
  'other yards/brokers',
  'retail/walk-in',
  'mixed',
]
export const FEED_WILLINGNESS = ['yes', 'maybe', 'no']

export const EMPTY_INTAKE: Omit<Intake, 'yard_id'> = {
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

/** Count of the ten objective answers, for the progress bar. */
export function answeredCount(f: Omit<Intake, 'yard_id'>) {
  return [
    f.inventory_size,
    f.ims_vendor,
    f.publishes_where?.length ? 'y' : null,
    f.update_frequency,
    f.pct_availability_calls,
    f.top_families?.length ? 'y' : null,
    f.buyer_mix,
    f.feed_willingness,
    f.exclusivity_constraint,
    f.rep_confidence,
  ].filter((v) => v !== null && v !== undefined).length
}

export function Card({
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

export function Chips({
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

export function MultiChips({
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

type SetFn = <K extends keyof Omit<Intake, 'yard_id'>>(key: K, value: Intake[K]) => void

/**
 * All eleven cards. `audience` only changes second-person phrasing — never the
 * answer options, so rep-collected and self-reported rows stay comparable.
 */
export function IntakeQuestions({
  form,
  set,
  audience,
}: {
  form: Omit<Intake, 'yard_id'>
  set: SetFn
  audience: 'rep' | 'yard'
}) {
  const isYard = audience === 'yard'

  return (
    <div className="space-y-3">
      <Card n={1} prompt="Roughly how many parts do you have on the yard right now?">
        <Chips
          options={INVENTORY_SIZE}
          value={form.inventory_size}
          onChange={(v) => set('inventory_size', v)}
        />
      </Card>

      <Card
        n={2}
        prompt="What do you use to track inventory?"
        hint={
          isYard
            ? 'Whatever you actually use day to day — spreadsheet and paper are common answers.'
            : 'This is the single best predictor of whether they can send a feed.'
        }
      >
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
        hint="0–10."
      >
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 11 }, (_, i) => i).map((i) => (
            <button
              key={i}
              type="button"
              onClick={() => set('pct_availability_calls', i)}
              className={`h-12 w-12 rounded-lg text-sm font-bold ${
                form.pct_availability_calls === i
                  ? 'bg-violet-600 text-white'
                  : 'bg-slate-800 text-slate-300'
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

      <Card
        n={9}
        prompt="If maybe/no — what's the hesitation?"
        hint={isYard ? 'Be blunt. We would rather hear the real objection.' : "Their words, not yours. This list is the product roadmap."}
      >
        <textarea
          value={form.feed_objection ?? ''}
          onChange={(e) => set('feed_objection', e.target.value)}
          rows={3}
          placeholder={isYard ? 'What would stop you?' : 'Type what they actually said…'}
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
                form.exclusivity_constraint === o.v
                  ? 'bg-violet-600 text-white'
                  : 'bg-slate-800 text-slate-300'
              }`}
            >
              {o.l}
            </button>
          ))}
        </div>
      </Card>

      <Card
        n={11}
        prompt={
          isYard
            ? 'How likely are you to actually try a live feed?'
            : 'Your read: does this yard actually convert to a feed?'
        }
        hint={isYard ? '1 = never, 5 = ready now.' : '1 = no chance, 5 = certain. Your gut, not theirs.'}
      >
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
  )
}
