/**
 * YardLine seeder — discovers HD truck salvage / heavy-duty truck parts yards
 * in metro Atlanta and emits an idempotent SQL upsert artifact.
 *
 * Obeys SCRAPING_POLICY.md:
 *   - logged-out public pages only
 *   - never circumvent an access control (TruckPartsInventory.com is SKIPPED)
 *   - 4s delay per host, single-threaded; Nominatim <= 1 req/s
 *   - honest descriptive User-Agent
 *   - facts only; source_url on every record; never fabricate a value
 *
 * Output: supabase/seed-yards.sql  (apply with psql or the Supabase SQL editor)
 *         supabase/seed-yards.json (audit trail: every record + its sources)
 *
 * Run: pnpm dlx tsx scripts/seed-yards.ts
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const UA = 'YardLineBot/0.1 (+mailto:michael@modularequity.com)'
const ATL = { lat: 33.749, lng: -84.388 }
const RADIUS_MI = 60
// bbox comfortably containing the 60-mile radius
const BBOX = { s: 33.05, w: -85.1, n: 34.45, e: -83.68 }

const IN_SCOPE_COUNTIES = [
  'Fulton', 'DeKalb', 'Cobb', 'Gwinnett', 'Clayton', 'Henry', 'Cherokee',
  'Douglas', 'Fayette', 'Rockdale', 'Newton', 'Paulding', 'Coweta',
  'Forsyth', 'Barrow', 'Walton', 'Bartow', 'Carroll', 'Spalding',
]

// ---------------------------------------------------------------------------
// Classification. The brief's raw keyword list matches every "Auto Parts" chain
// in the metro (249 false hits). These rules are what keep the census clean.
// ---------------------------------------------------------------------------
const CHAIN_BLOCKLIST =
  /o'?reilly|advance auto|napa|autozone|auto zone|pep boys|carquest|genuine parts|discount tire|firestone|goodyear|midas|jiffy lube|valvoline|take 5|mavis|batteries plus|harbor freight|tractor supply|walmart|costco|sam's club|u-?haul|penske|ryder|enterprise|hertz/i

// Names that match a truck token but are obviously not parts businesses.
const NOT_A_BUSINESS =
  /pizza|taco|restaurant|catering|caterer|food truck|coffee|ice cream|brewery|church|school|park|library|museum|apartment|hotel|motel/i

const SALVAGE_TOKENS =
  /salvage|wreck|dismantl|recycl|junk|used\s+(truck|part)|core\s+supply|parts?\s+yard/i
const HD_TOKENS =
  /truck|diesel|semi|tractor\s*(&|and)?\s*trailer|trailer|heavy\s*-?\s*duty|\bhd\b|freightliner|peterbilt|kenworth|mack\b|international\s*truck|volvo\s*truck|western\s*star|navistar/i
const OEM_DEALER =
  /rush truck|nextran|peterbilt of|kenworth of|freightliner of|mhc |worldwide equipment|transource|four star freightliner|carolina international|tag truck|mack trucks|volvo trucks|western star of/i
const SCRAP_METAL =
  /scrap|metal recycling|steel|iron\s*(&|and)?\s*metal|sa recycling|newell|radius recycling|shredder/i

type YardType = 'hd_salvage' | 'oem_dealer' | 'scrap_metal' | 'retail_chain' | 'unknown'

function classify(name: string, tags: Record<string, string> = {}): YardType {
  const n = name || ''
  if (CHAIN_BLOCKLIST.test(n)) return 'retail_chain'
  if (NOT_A_BUSINESS.test(n)) return 'retail_chain' // excluded either way
  if (OEM_DEALER.test(n)) return 'oem_dealer'
  // Scrap-metal recyclers buy ferrous tonnage; they do not sell HD parts.
  if (SCRAP_METAL.test(n) && !SALVAGE_TOKENS.test(n.replace(SCRAP_METAL, ''))) return 'scrap_metal'
  if (SALVAGE_TOKENS.test(n) && HD_TOKENS.test(n)) return 'hd_salvage'
  if (SALVAGE_TOKENS.test(n) && /auto|car\b/i.test(n)) return 'scrap_metal' // auto (light) salvage
  if (SALVAGE_TOKENS.test(n)) return 'hd_salvage'
  if (HD_TOKENS.test(n) && /part|supply|equipment|core/i.test(n)) return 'hd_salvage'
  if (tags.industrial === 'scrap_yard' && HD_TOKENS.test(n)) return 'hd_salvage'
  return 'unknown'
}

/** Only these become callable prospects. Everything else is dropped, not stored. */
const KEEP: YardType[] = ['hd_salvage', 'oem_dealer']

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function get(url: string, init: RequestInit = {}) {
  return fetch(url, { ...init, headers: { 'User-Agent': UA, ...(init.headers || {}) } })
}

function normName(s: string) {
  return (s || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(inc|llc|co|corp|company|the|of|and)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function digits(s?: string | null) {
  return (s || '').replace(/\D/g, '')
}

function last7(s?: string | null) {
  const d = digits(s)
  return d.length >= 7 ? d.slice(-7) : ''
}

function fmtPhone(s?: string | null): string | null {
  const d = digits(s)
  const t = d.length === 11 && d.startsWith('1') ? d.slice(1) : d
  if (t.length !== 10) return null
  return `${t.slice(0, 3)}-${t.slice(3, 6)}-${t.slice(6)}`
}

function miles(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 3958.8
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLng = ((bLng - aLng) * Math.PI) / 180
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}

// ---------------------------------------------------------------------------
// record model
// ---------------------------------------------------------------------------
type Rec = {
  name: string
  address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  county?: string | null
  lat?: number | null
  lng?: number | null
  phone?: string | null
  website?: string | null
  source: string
  source_urls: string[]
  osm_id?: string | null
  yard_type: YardType
  published_listing_count?: number | null
  publishes_online?: boolean | null
}

const records = new Map<string, Rec>()

function dedupeKey(r: Rec) {
  return `${normName(r.name)}|${last7(r.phone)}`
}

/** Merge rather than duplicate; keep the richest value for each field. */
function upsert(r: Rec) {
  if (!r.name || !r.name.trim()) return
  if (!KEEP.includes(r.yard_type)) return
  // Rule: a record needs a real name + (phone OR address). Never invent either.
  if (!r.phone && !r.address) return

  const key = dedupeKey(r)
  const prev = records.get(key)
  if (!prev) {
    records.set(key, { ...r, source_urls: [...new Set(r.source_urls)] })
    return
  }
  const merged: Rec = { ...prev }
  for (const f of [
    'address', 'city', 'state', 'zip', 'county', 'phone', 'website', 'osm_id',
  ] as const) {
    if (!merged[f] && r[f]) (merged as Record<string, unknown>)[f] = r[f]
  }
  if (merged.lat == null && r.lat != null) { merged.lat = r.lat; merged.lng = r.lng }
  if (merged.published_listing_count == null && r.published_listing_count != null) {
    merged.published_listing_count = r.published_listing_count
  }
  if (r.publishes_online) merged.publishes_online = true
  if (merged.yard_type === 'unknown' && r.yard_type !== 'unknown') merged.yard_type = r.yard_type
  merged.source = [...new Set([...prev.source.split('+'), ...r.source.split('+')])].join('+')
  merged.source_urls = [...new Set([...prev.source_urls, ...r.source_urls])]
  records.set(key, merged)
}

// ---------------------------------------------------------------------------
// SOURCE 1 — Overpass / OpenStreetMap (ODbL, © OpenStreetMap contributors)
// ---------------------------------------------------------------------------
async function fromOverpass() {
  const q = `
[out:json][timeout:120];
(
  nwr["shop"="truck"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
  nwr["shop"="car_parts"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
  nwr["shop"="trade"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
  nwr["craft"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
  nwr["industrial"="scrap_yard"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
  nwr["shop"="agrarian"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
);
out center tags;`
  console.log('[overpass] querying...')
  const res = await get('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: 'data=' + encodeURIComponent(q),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  if (!res.ok) { console.warn('[overpass] HTTP ' + res.status + ' — skipping source'); return }
  type OsmEl = {
    type: string
    id: number
    lat?: number
    lon?: number
    center?: { lat: number; lon: number }
    tags?: Record<string, string>
  }
  const data = (await res.json()) as { elements: OsmEl[] }
  const els = data.elements || []
  console.log(`[overpass] ${els.length} elements`)

  let kept = 0, dropped = 0
  for (const el of els) {
    const t = el.tags || {}
    const name = t.name || t['name:en'] || ''
    if (!name) continue
    const type = classify(name, t)
    if (!KEEP.includes(type)) { dropped++; continue }

    const lat = el.lat ?? el.center?.lat ?? null
    const lng = el.lon ?? el.center?.lon ?? null
    if (lat != null && lng != null && miles(ATL.lat, ATL.lng, lat, lng) > RADIUS_MI) continue

    const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ') || null
    const osmId = `${el.type}/${el.id}`
    upsert({
      name,
      address: street,
      city: t['addr:city'] || null,
      state: t['addr:state'] || 'GA',
      zip: t['addr:postcode'] || null,
      county: null,
      lat, lng,
      phone: fmtPhone(t.phone || t['contact:phone']),
      website: t.website || t['contact:website'] || null,
      source: 'osm',
      source_urls: [`https://www.openstreetmap.org/${osmId}`],
      osm_id: osmId,
      yard_type: type,
    })
    kept++
  }
  console.log(`[overpass] kept ${kept}, dropped ${dropped} (chains/scrap/non-HD)`)
}

// ---------------------------------------------------------------------------
// SOURCE 2 — HeavyTruckParts.net vendor directory
// robots.txt: Crawl-delay 4, disallows *?*page=* (we never send page=)
// ---------------------------------------------------------------------------
const HTP_DELAY = 4000

async function fromHeavyTruckParts() {
  const url = 'https://www.heavytruckparts.net/vendors.php'
  console.log('[htp] fetching vendor directory...')
  const res = await get(url)
  if (!res.ok) { console.warn('[htp] HTTP ' + res.status + ' — skipping source'); return }
  const html = await res.text()

  // Vendor blocks: a store link, a <strong>name</strong>, a tel: phone, then
  // street<br>City, ST ZIP. Facts only — we ignore the marketing blurbs.
  const blockRe =
    /<a href='\/search\.php\?fltpc=(\d+)&amp;store=(\d+)'>\s*<strong>([^<]+)<\/strong><\/a>\s*<p>\s*<a href='tel:([^']+)'[^>]*>[^<]*<\/a>\s*<br>([^<]+)<br>([^<]+)<\/p>/g

  // Listing counts measured from the site's own sitemap (scripts/htp-listing-counts.ts).
  let counts: Record<string, number> = {}
  const cPath = join(process.cwd(), 'data', 'htp-listing-counts.json')
  if (existsSync(cPath)) {
    counts = JSON.parse(readFileSync(cPath, 'utf8')) as Record<string, number>
    console.log(`[htp] loaded listing counts for ${Object.keys(counts).length} sellers`)
  } else {
    console.warn('[htp] no data/htp-listing-counts.json — published_listing_count will be null')
  }

  const found: Array<{
    fltpc: string; store: string; name: string; phone: string; street: string; loc: string
  }> = []
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(html))) {
    found.push({
      fltpc: m[1],
      store: m[2],
      name: m[3].replace(/&amp;/g, '&').trim(),
      phone: m[4].trim(),
      street: m[5].trim(),
      loc: m[6].replace(/&amp;/g, '&').trim(),
    })
  }
  console.log(`[htp] parsed ${found.length} vendor rows`)

  const ga = found.filter((v) => /,\s*GA\b/i.test(v.loc))
  console.log(`[htp] ${ga.length} Georgia vendors (this number is itself a census finding)`)

  for (const v of ga) {
    const lm = v.loc.match(/^(.*?),\s*([A-Z]{2})\s*([\d-]+)?$/i)
    const city = lm ? lm[1].trim() : null
    const zip = lm && lm[3] ? lm[3].slice(0, 5) : null

    const rec: Rec = {
      name: v.name,
      address: v.street,
      city,
      state: 'GA',
      zip,
      county: null,
      lat: null, lng: null,
      phone: fmtPhone(v.phone),
      website: null,
      source: 'heavytruckparts.net',
      source_urls: [url],
      yard_type: classify(v.name) === 'unknown' ? 'hd_salvage' : classify(v.name),
      publishes_online: true,
      published_listing_count: null,
    }
    // Listed on HTP => by definition an HD parts seller.
    if (!KEEP.includes(rec.yard_type)) rec.yard_type = 'hd_salvage'

    // published_listing_count — the fragmentation measurement. Counted from the
    // seller's own item URLs in the public sitemap; null when not measurable.
    rec.published_listing_count = counts[v.fltpc] ?? null
    rec.source_urls.push(`https://www.heavytruckparts.net/search.php?fltpc=${v.fltpc}&store=${v.store}`)
    console.log(`[htp]   ${v.name} (${city}) listings=${rec.published_listing_count ?? 'null'}`)
    upsert(rec)
  }
}

// ---------------------------------------------------------------------------
// SOURCE 3 — TruckPartsInventory.com: DELIBERATELY SKIPPED.
// Cloudflare interactive challenge (HTTP 403). See SCRAPING_POLICY.md rule 2.
// ---------------------------------------------------------------------------
function truckPartsInventoryNotice() {
  console.log(
    '[tpi] SKIPPED — host returns HTTP 403 Cloudflare interactive challenge.\n' +
    '[tpi] Access control; not circumvented by policy. See SCRAPING_POLICY.md.'
  )
}

// ---------------------------------------------------------------------------
// SOURCE 4 — human/agent-verified yards, each checked against its own website.
// Curated into data/verified-yards.json with a source_url per record.
// ---------------------------------------------------------------------------
function fromVerifiedFile() {
  const p = join(process.cwd(), 'data', 'verified-yards.json')
  if (!existsSync(p)) { console.log('[verified] no data/verified-yards.json — skipping'); return }
  const rows = JSON.parse(readFileSync(p, 'utf8')) as Array<Partial<Rec> & { name: string }>
  let n = 0
  for (const r of rows) {
    const type = (r.yard_type as YardType) || classify(r.name)
    upsert({
      name: r.name,
      address: r.address ?? null,
      city: r.city ?? null,
      state: r.state ?? 'GA',
      zip: r.zip ?? null,
      county: r.county ?? null,
      lat: r.lat ?? null,
      lng: r.lng ?? null,
      phone: fmtPhone(r.phone),
      website: r.website ?? null,
      source: r.source || 'verified_web',
      source_urls: r.source_urls || (r.website ? [r.website] : []),
      yard_type: KEEP.includes(type) ? type : 'hd_salvage',
      published_listing_count: r.published_listing_count ?? null,
      publishes_online: r.publishes_online ?? null,
    })
    n++
  }
  console.log(`[verified] loaded ${n} verified records`)
}

// ---------------------------------------------------------------------------
// Geocode missing coordinates — Nominatim, <= 1 req/sec (hard policy limit)
// ---------------------------------------------------------------------------
/**
 * Enforce the 60-mile scope for every source, not just OSM. Directory sources
 * give us an address but no coordinates, so this has to run after geocoding —
 * otherwise south-Georgia yards (Douglas, 200mi away) land in the call list.
 */
function pruneOutOfScope() {
  let dropped = 0
  for (const [k, r] of [...records.entries()]) {
    if (r.lat == null || r.lng == null) continue
    if (miles(ATL.lat, ATL.lng, r.lat, r.lng) > RADIUS_MI) {
      records.delete(k)
      dropped++
      console.log(`[scope] dropped ${r.name} (${r.city}) — outside ${RADIUS_MI} mi`)
    }
  }
  if (dropped) console.log(`[scope] ${dropped} record(s) outside the metro-Atlanta radius`)
}

async function geocodeMissing() {
  const need = [...records.values()].filter((r) => r.lat == null && (r.address || r.city))
  console.log(`[nominatim] geocoding ${need.length} records at 1 req/s...`)
  for (const r of need) {
    const q = [r.address, r.city, r.state, r.zip].filter(Boolean).join(', ')
    try {
      await sleep(1100)
      const res = await get(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=us`
      )
      if (!res.ok) continue
      const j = (await res.json()) as Array<{ lat: string; lon: string }>
      if (j[0]) { r.lat = parseFloat(j[0].lat); r.lng = parseFloat(j[0].lon) }
    } catch { /* leave null — an empty field is data */ }
  }
}

// ---------------------------------------------------------------------------
// County backfill from city (best effort; null when unknown — never guessed)
// ---------------------------------------------------------------------------
const CITY_COUNTY: Record<string, string> = {
  atlanta: 'Fulton', 'college park': 'Fulton', 'east point': 'Fulton', roswell: 'Fulton',
  alpharetta: 'Fulton', 'sandy springs': 'Fulton', fairburn: 'Fulton', palmetto: 'Fulton',
  union_city: 'Fulton', 'union city': 'Fulton',
  decatur: 'DeKalb', doraville: 'DeKalb', chamblee: 'DeKalb', tucker: 'DeKalb',
  clarkston: 'DeKalb', stone_mountain: 'DeKalb', 'stone mountain': 'DeKalb', lithonia: 'DeKalb',
  marietta: 'Cobb', smyrna: 'Cobb', kennesaw: 'Cobb', acworth: 'Cobb', austell: 'Cobb',
  mableton: 'Cobb', powder_springs: 'Cobb', 'powder springs': 'Cobb',
  lawrenceville: 'Gwinnett', norcross: 'Gwinnett', duluth: 'Gwinnett', lilburn: 'Gwinnett',
  buford: 'Gwinnett', snellville: 'Gwinnett', suwanee: 'Gwinnett', 'sugar hill': 'Gwinnett',
  'forest park': 'Clayton', jonesboro: 'Clayton', morrow: 'Clayton', riverdale: 'Clayton',
  'lake city': 'Clayton',
  mcdonough: 'Henry', stockbridge: 'Henry', hampton: 'Henry', locust_grove: 'Henry',
  'locust grove': 'Henry',
  canton: 'Cherokee', woodstock: 'Cherokee',
  douglasville: 'Douglas', lithia_springs: 'Douglas', 'lithia springs': 'Douglas',
  fayetteville: 'Fayette', peachtree_city: 'Fayette', 'peachtree city': 'Fayette',
  conyers: 'Rockdale', covington: 'Newton', dallas: 'Paulding', hiram: 'Paulding',
  newnan: 'Coweta', cumming: 'Forsyth', winder: 'Barrow', monroe: 'Walton',
  cartersville: 'Bartow', 'white': 'Bartow', emerson: 'Bartow',
  carrollton: 'Carroll', villa_rica: 'Carroll', 'villa rica': 'Carroll',
  griffin: 'Spalding',
}

function backfillCounties() {
  for (const r of records.values()) {
    if (r.county) continue
    const c = (r.city || '').toLowerCase().trim()
    if (c && CITY_COUNTY[c]) r.county = CITY_COUNTY[c]
  }
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------
function sq(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'null'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return `'${String(v).replace(/'/g, "''")}'`
}

function emit() {
  backfillCounties()
  const rows = [...records.values()]
  const withPhone = rows.filter((r) => r.phone).length
  const pct = rows.length ? Math.round((100 * withPhone) / rows.length) : 0

  const bySource: Record<string, number> = {}
  const byType: Record<string, number> = {}
  const byCounty: Record<string, number> = {}
  for (const r of rows) {
    bySource[r.source] = (bySource[r.source] || 0) + 1
    byType[r.yard_type] = (byType[r.yard_type] || 0) + 1
    byCounty[r.county || 'unknown'] = (byCounty[r.county || 'unknown'] || 0) + 1
  }

  const sql = [
    '-- YardLine seed — generated by scripts/seed-yards.ts',
    `-- generated_at: ${new Date().toISOString()}`,
    `-- records: ${rows.length}  with_phone: ${withPhone} (${pct}%)`,
    '-- Every row traces to a source_url. No value here was invented.',
    '',
    ...rows.map((r) => {
      const cols = [
        'name', 'address', 'city', 'state', 'zip', 'county', 'lat', 'lng', 'phone',
        'website', 'source', 'source_url', 'osm_id', 'yard_type',
        'published_listing_count', 'publishes_online', 'dedupe_key',
      ]
      const vals = [
        sq(r.name), sq(r.address), sq(r.city), sq(r.state), sq(r.zip), sq(r.county),
        r.lat == null ? 'null' : String(r.lat), r.lng == null ? 'null' : String(r.lng),
        sq(r.phone), sq(r.website), sq(r.source), sq(r.source_urls.join(' | ')),
        sq(r.osm_id), sq(r.yard_type),
        r.published_listing_count == null ? 'null' : String(r.published_listing_count),
        r.publishes_online == null ? 'null' : String(r.publishes_online),
        sq(dedupeKey(r)),
      ]
      return (
        `insert into yards (${cols.join(', ')}) values (${vals.join(', ')})\n` +
        `on conflict (dedupe_key) do update set\n` +
        `  phone = coalesce(yards.phone, excluded.phone),\n` +
        `  address = coalesce(yards.address, excluded.address),\n` +
        `  city = coalesce(yards.city, excluded.city),\n` +
        `  zip = coalesce(yards.zip, excluded.zip),\n` +
        `  county = coalesce(yards.county, excluded.county),\n` +
        `  lat = coalesce(yards.lat, excluded.lat),\n` +
        `  lng = coalesce(yards.lng, excluded.lng),\n` +
        `  website = coalesce(yards.website, excluded.website),\n` +
        `  published_listing_count = coalesce(yards.published_listing_count, excluded.published_listing_count),\n` +
        `  publishes_online = coalesce(yards.publishes_online, excluded.publishes_online),\n` +
        `  source_url = excluded.source_url,\n` +
        `  updated_at = now();`
      )
    }),
  ].join('\n')

  mkdirSync(join(process.cwd(), 'supabase'), { recursive: true })
  writeFileSync(join(process.cwd(), 'supabase', 'seed-yards.sql'), sql + '\n')
  writeFileSync(
    join(process.cwd(), 'supabase', 'seed-yards.json'),
    JSON.stringify({ generated_at: new Date().toISOString(), counts: { total: rows.length, withPhone, pct, bySource, byType, byCounty }, records: rows }, null, 2)
  )

  console.log('\n===== SEED SUMMARY =====')
  console.log(`total yards:      ${rows.length}`)
  console.log(`with phone:       ${withPhone} (${pct}%)`)
  console.log('by source:       ', bySource)
  console.log('by yard_type:    ', byType)
  console.log('by county:       ', byCounty)
  console.log(`\nVERIFY >=25 yards: ${rows.length >= 25 ? 'PASS' : 'FAIL (' + rows.length + ')'}`)
  console.log(`VERIFY >=80% phone: ${pct >= 80 ? 'PASS' : 'FAIL (' + pct + '%)'}`)
  console.log('wrote supabase/seed-yards.sql and supabase/seed-yards.json')
}

async function main() {
  truckPartsInventoryNotice()
  fromVerifiedFile()
  await fromOverpass()
  try { await fromHeavyTruckParts() } catch (e) { console.warn('[htp] failed:', e) }
  await geocodeMissing()
  pruneOutOfScope()
  emit()
}

main().catch((e) => { console.error(e); process.exit(1) })
