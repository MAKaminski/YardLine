export const STAGES = [
  'new',
  'attempted',
  'contacted',
  'discovery_done',
  'feed_agreed',
  'live',
  'dead',
] as const

export type Stage = (typeof STAGES)[number]

export const STAGE_COLOR: Record<Stage, string> = {
  new: '#64748b',
  attempted: '#f59e0b',
  contacted: '#3b82f6',
  discovery_done: '#8b5cf6',
  feed_agreed: '#10b981',
  live: '#059669',
  dead: '#ef4444',
}

export const STAGE_LABEL: Record<Stage, string> = {
  new: 'New',
  attempted: 'Attempted',
  contacted: 'Contacted',
  discovery_done: 'Discovery done',
  feed_agreed: 'Feed agreed',
  live: 'Live',
  dead: 'Dead',
}

export type Yard = {
  id: string
  name: string
  dba: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  county: string | null
  lat: number | null
  lng: number | null
  phone: string | null
  phone_alt: string | null
  email: string | null
  website: string | null
  source: string
  source_url: string | null
  yard_type: string | null
  published_listing_count: number | null
  publishes_online: boolean | null
  ims_vendor: string | null
  stage: Stage
  created_at: string
  updated_at: string
}

export type Activity = {
  id: string
  yard_id: string
  contact_id: string | null
  user_email: string | null
  type: string | null
  disposition: string | null
  notes: string | null
  occurred_at: string
  next_action: string | null
  next_action_due: string | null
}

export type Contact = {
  id: string
  yard_id: string
  name: string | null
  title: string | null
  phone: string | null
  email: string | null
  is_primary: boolean | null
  notes: string | null
}

export type Intake = {
  id?: string
  yard_id: string
  completed_by: string | null
  completed_at: string | null
  inventory_size: string | null
  ims_vendor: string | null
  publishes_where: string[] | null
  update_frequency: string | null
  pct_availability_calls: number | null
  top_families: string[] | null
  buyer_mix: string | null
  feed_willingness: string | null
  feed_objection: string | null
  exclusivity_constraint: boolean | null
  rep_confidence: number | null
}

/**
 * Dispositions a rep can log in one tap, and the stage each one advances to.
 * `null` means "leave the stage alone" — a no-answer should never move a yard
 * backwards or forwards.
 */
export const DISPOSITIONS: Array<{
  key: string
  label: string
  advancesTo: Stage | null
  tone: string
}> = [
  { key: 'connected', label: 'Connected', advancesTo: 'contacted', tone: 'bg-blue-600' },
  { key: 'no_answer', label: 'No answer', advancesTo: 'attempted', tone: 'bg-slate-600' },
  { key: 'voicemail', label: 'Voicemail', advancesTo: 'attempted', tone: 'bg-slate-600' },
  { key: 'gatekeeper', label: 'Gatekeeper', advancesTo: 'attempted', tone: 'bg-amber-600' },
  { key: 'callback', label: 'Callback', advancesTo: 'contacted', tone: 'bg-amber-600' },
  { key: 'qualified', label: 'Qualified', advancesTo: 'contacted', tone: 'bg-emerald-600' },
  { key: 'not_interested', label: 'Not interested', advancesTo: 'dead', tone: 'bg-red-600' },
]

/** IMS vendors that can actually emit a live feed. Drives /census "Feedable". */
export const FEEDABLE_IMS = ['ITrack', 'Checkmate/Car-Part', 'Hollander Powerlink', 'Pinnacle']

export function milesBetween(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 3958.8
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLng = ((bLng - aLng) * Math.PI) / 180
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}
