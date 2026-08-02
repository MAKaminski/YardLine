/**
 * YardLine price collector.
 *
 * Builds a real HD truck parts price index from HeavyTruckParts.net's public
 * item pages, so the vendor tool can tell a yard what its parts are worth.
 *
 * SCRAPING_POLICY.md compliance:
 *   - logged-out public pages only; robots.txt permits /item/
 *   - Crawl-delay: 4 honored, single-threaded, one host
 *   - no `page=` parameter is ever sent (the only wildcard disallow)
 *   - honest descriptive User-Agent with a contact address
 *   - FACTS ONLY: year, make, model, part type, price, stock #, seller
 *     city/state, availability, source_url. We deliberately do NOT read or
 *     store listing descriptions, marketing prose, or any image.
 *   - every row carries source_url for attribution
 *
 * One item page yields ~11 price points: the listing itself plus the
 * "Related Items From <seller>" block, which prints year/type/make/model/price
 * per thumbnail. That is what makes an hour of crawling worth doing.
 *
 * Run: pnpm dlx tsx scripts/collect-prices.ts --minutes=60
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

const UA = 'YardLineBot/0.1 (+mailto:michael@modularequity.com)'
const HOST = 'https://www.heavytruckparts.net'
const DELAY = 4000
const SOURCE = 'heavytruckparts.net'
const CACHE = join(process.cwd(), '.cache', 'htp')

const minutesArg = process.argv.find((a) => a.startsWith('--minutes='))
const BUDGET_MS = (minutesArg ? parseInt(minutesArg.split('=')[1], 10) : 60) * 60_000
const startedAt = Date.now()
const timeLeft = () => BUDGET_MS - (Date.now() - startedAt)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const get = (url: string) => fetch(url, { headers: { 'User-Agent': UA } })

/**
 * Part families the census cares about. Matched against the part-type slug in
 * the item URL. Front-end trim (bumpers, grilles, fenders) is deliberately
 * excluded — it dominates the sitemap by volume but is not what decides
 * whether a yard's inventory is worth aggregating.
 */
const TARGET_FAMILIES: Array<{ family: string; re: RegExp }> = [
  { family: 'engines', re: /^engine/i },
  { family: 'transmissions', re: /^transmission/i },
  { family: 'rears/differentials', re: /^(rears?|differential|carrier)/i },
  { family: 'cabs', re: /^cab\b|^cab-/i },
  { family: 'hoods', re: /^hood/i },
  { family: 'aftertreatment/DPF', re: /(dpf|aftertreatment|exhaust-after|scr|def-)/i },
  { family: 'turbos', re: /^turbo/i },
  { family: 'axles/suspension', re: /^(axle|suspension|spring|leaf)/i },
  { family: 'electronics/ECMs', re: /(ecm|electronic-chassis|instrument-cluster|control-module)/i },
]

function familyOf(partTypeSlug: string): string | null {
  for (const t of TARGET_FAMILIES) if (t.re.test(partTypeSlug)) return t.family
  return null
}

type Listing = {
  source: string
  source_url: string
  stock_no: string
  year: number | null
  make: string | null
  model: string | null
  part_type: string
  part_family: string | null
  price: number | null
  seller_city: string | null
  seller_state: string | null
  seller_name: string | null
  seller_account: string | null
  seller_branch: string | null
  is_available: boolean
  observed_at: string
}

const listings = new Map<string, Listing>()

function slugToLabel(s: string) {
  return decodeURIComponent(s).replace(/-+/g, ' ').replace(/\s+/g, ' ').trim()
}

function parsePrice(s: string): number | null {
  const n = parseFloat(s.replace(/[$,]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Item URL shape: /item/{Make}/{Model}/{PartType}/{account}/{branch}/{stock} */
function parseItemUrl(u: string) {
  const seg = u.split('/')
  if (seg.length < 8) return null
  return {
    make: slugToLabel(seg[seg.length - 6]),
    model: slugToLabel(seg[seg.length - 5]),
    partTypeSlug: seg[seg.length - 4],
    account: seg[seg.length - 3],
    branch: seg[seg.length - 2],
    stock: seg[seg.length - 1],
  }
}

function add(l: Listing) {
  if (!l.stock_no || l.price == null) return
  const prev = listings.get(l.stock_no)
  // Prefer the record with more fields filled in (the item page beats a thumbnail).
  if (prev) {
    const score = (x: Listing) =>
      [x.year, x.seller_city, x.seller_name, x.make, x.model].filter(Boolean).length
    if (score(prev) >= score(l)) return
  }
  listings.set(l.stock_no, l)
}

// ---------------------------------------------------------------------------
// Sitemap enumeration (cached — re-runs skip the download)
// ---------------------------------------------------------------------------
async function itemUrls(): Promise<string[]> {
  mkdirSync(CACHE, { recursive: true })
  const cached = join(CACHE, 'item-urls.json')
  if (existsSync(cached)) {
    const urls = JSON.parse(readFileSync(cached, 'utf8')) as string[]
    console.log(`[sitemap] ${urls.length} item URLs from cache`)
    return urls
  }

  const idx = await (await get(`${HOST}/sitemap_index.xml`)).text()
  const maps = [...idx.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  console.log(`[sitemap] ${maps.length} sitemaps`)

  const urls: string[] = []
  for (const [i, m] of maps.entries()) {
    await sleep(DELAY)
    try {
      const res = await get(m)
      if (!res.ok) continue
      const buf = Buffer.from(await res.arrayBuffer())
      const body = m.endsWith('.gz') ? gunzipSync(buf).toString('utf8') : buf.toString('utf8')
      for (const mm of body.matchAll(/https:\/\/www\.heavytruckparts\.net\/item\/[^<\s]+/g)) {
        urls.push(mm[0])
      }
      console.log(`[sitemap] ${i + 1}/${maps.length} — ${urls.length} item URLs`)
    } catch {
      /* skip a bad sitemap rather than abort the run */
    }
  }
  writeFileSync(cached, JSON.stringify(urls))
  return urls
}

// ---------------------------------------------------------------------------
// Item page parsing — facts only
// ---------------------------------------------------------------------------
function parseItemPage(url: string, html: string): Listing[] {
  const out: Listing[] = []
  const now = new Date().toISOString()
  const meta = parseItemUrl(url)
  if (!meta) return out

  // Primary listing. <title> carries "NAME in City, ST $1,234.56 #stock".
  const title = html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? ''
  const t = title.match(/\sin\s+(.+?),\s*([A-Z]{2})\s*\$([\d,]+\.\d{2})\s*#(\d+)/)
  const sellerName = html.match(/Related Items From\s*([^<]{2,60})</i)?.[1]?.trim() ?? null
  // Availability: the page says so in plain text when a listing is retired.
  const available = !/no longer available/i.test(html)
  // Year appears alongside the tag number in the heading region.
  const year =
    html.match(/Tag\s*#:\s*\d+\s*<[^>]*>\s*((?:19|20)\d{2})/i)?.[1] ??
    html.match(/>\s*((?:19|20)\d{2})\s+[A-Z][A-Z-]{2,}\s/)?.[1] ??
    null

  if (t) {
    out.push({
      source: SOURCE,
      source_url: url,
      stock_no: t[4],
      year: year ? parseInt(year, 10) : null,
      make: meta.make === '-' ? null : meta.make,
      model: meta.model === '-' ? null : meta.model,
      part_type: slugToLabel(meta.partTypeSlug),
      part_family: familyOf(meta.partTypeSlug),
      price: parsePrice(t[3]),
      seller_city: t[1].trim(),
      seller_state: t[2],
      seller_name: sellerName,
      seller_account: meta.account,
      seller_branch: meta.branch,
      is_available: available,
      observed_at: now,
    })
  }

  // Related-items thumbnails: href then <br>YEAR<br>TYPE<br>MAKE<br>MODEL<br>$PRICE<br>
  // We read only the text the site prints; the img tag is skipped entirely.
  const relRe =
    /<a href='(\/item\/[^']+)'>[\s\S]{0,600}?<br>\s*((?:19|20)\d{2})?\s*<br>([^<]{2,60})<br>([^<]{1,40})<br>([^<]{1,40})<br>\s*\$([\d,]+\.\d{2})/g
  let r: RegExpExecArray | null
  while ((r = relRe.exec(html))) {
    const rm = parseItemUrl(r[1])
    if (!rm) continue
    out.push({
      source: SOURCE,
      source_url: `${HOST}${r[1]}`,
      stock_no: rm.stock,
      year: r[2] ? parseInt(r[2], 10) : null,
      make: (r[4] || '').trim() || (rm.make === '-' ? null : rm.make),
      model: (r[5] || '').trim() || (rm.model === '-' ? null : rm.model),
      part_type: (r[3] || '').trim() || slugToLabel(rm.partTypeSlug),
      part_family: familyOf(rm.partTypeSlug),
      price: parsePrice(r[6]),
      seller_city: null,
      seller_state: null,
      seller_name: sellerName,
      seller_account: rm.account,
      seller_branch: rm.branch,
      is_available: true,
      observed_at: now,
    })
  }

  return out
}

// ---------------------------------------------------------------------------
function sq(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'null'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return `'${String(v).replace(/'/g, "''")}'`
}

function emit(checkpoint = false) {
  const rows = [...listings.values()]
  const byFamily: Record<string, number> = {}
  const prices: number[] = []
  for (const r of rows) {
    const k = r.part_family ?? 'other'
    byFamily[k] = (byFamily[k] || 0) + 1
    if (r.price != null) prices.push(r.price)
  }
  prices.sort((a, b) => a - b)
  const q = (p: number) => (prices.length ? prices[Math.floor((prices.length - 1) * p)] : 0)

  const cols = [
    'source', 'source_url', 'stock_no', 'year', 'make', 'model', 'part_type',
    'part_family', 'price', 'seller_city', 'seller_state', 'seller_name',
    'seller_account', 'seller_branch', 'is_available', 'observed_at',
  ]
  const values = rows
    .map((r) => `(${cols.map((c) => sq((r as unknown as Record<string, unknown>)[c])).join(', ')})`)
    .join(',\n')

  const sql =
    `-- YardLine price index — generated by scripts/collect-prices.ts\n` +
    `-- generated_at: ${new Date().toISOString()}  rows: ${rows.length}\n` +
    `-- Facts only. No descriptions, no images. source_url on every row.\n\n` +
    (rows.length
      ? `insert into parts_listings (${cols.join(', ')}) values\n${values}\n` +
        `on conflict (source, stock_no) do update set\n` +
        `  price = excluded.price,\n` +
        `  is_available = excluded.is_available,\n` +
        `  observed_at = excluded.observed_at;\n`
      : '-- no rows collected\n')

  mkdirSync(join(process.cwd(), 'supabase'), { recursive: true })
  writeFileSync(join(process.cwd(), 'supabase', 'seed-parts.sql'), sql)
  mkdirSync(join(process.cwd(), 'data'), { recursive: true })
  writeFileSync(
    join(process.cwd(), 'data', 'price-index-coverage.json'),
    JSON.stringify(
      {
        collected_at: new Date().toISOString(),
        source: SOURCE,
        rows: rows.length,
        by_family: byFamily,
        price_p25: q(0.25),
        price_median: q(0.5),
        price_p75: q(0.75),
      },
      null,
      2
    )
  )

  if (checkpoint) {
    console.log(`[checkpoint] wrote ${rows.length} listings`)
    return
  }

  console.log('\n===== PRICE INDEX =====')
  console.log(`listings: ${rows.length}`)
  console.log('by family:', byFamily)
  console.log(`price p25/median/p75: ${q(0.25)} / ${q(0.5)} / ${q(0.75)}`)
  console.log('wrote supabase/seed-parts.sql and data/price-index-coverage.json')
}

async function main() {
  const all = await itemUrls()

  // Keep only target families, then round-robin across (family, seller) so an
  // hour of crawling produces balanced coverage instead of 900 bumpers.
  //
  // Bucketing by seller as well as family matters more than it looks: the
  // related-items block on a page only ever shows OTHER parts from the SAME
  // seller, so consecutive pages from one yard return listings we already have.
  // Rotating sellers is what converts fetches into unique rows.
  const buckets = new Map<string, string[]>()
  for (const u of all) {
    const m = parseItemUrl(u)
    if (!m) continue
    const fam = familyOf(m.partTypeSlug)
    if (!fam) continue
    const key = `${fam}|${m.account}:${m.branch}`
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push(u)
  }
  const queue: string[] = []
  const keys = [...buckets.keys()]
  for (let i = 0; queue.length < 20000; i++) {
    let added = false
    for (const k of keys) {
      const arr = buckets.get(k)!
      if (i < arr.length) { queue.push(arr[i]); added = true }
    }
    if (!added) break
  }
  const famCount = new Set(keys.map((k) => k.split('|')[0])).size
  const sellerCount = new Set(keys.map((k) => k.split('|')[1])).size
  console.log(
    `[queue] ${queue.length} candidate pages across ${famCount} families / ${sellerCount} sellers`
  )

  let fetched = 0
  for (const u of queue) {
    if (timeLeft() < DELAY + 5000) {
      console.log(`[budget] time exhausted after ${fetched} pages`)
      break
    }
    await sleep(DELAY)
    try {
      const res = await get(u)
      if (!res.ok) { console.warn(`[item] HTTP ${res.status} ${u}`); continue }
      const html = await res.text()
      const parsed = parseItemPage(u, html)
      parsed.forEach(add)
      fetched++
      // Checkpoint as we go. An earlier run held everything in memory and only
      // wrote on exit, which meant interrupting it discarded the whole crawl.
      if (fetched % 25 === 0) emit(true)
      if (fetched % 10 === 0) {
        console.log(
          `[item] ${fetched} pages, ${listings.size} listings, ` +
            `${Math.round(timeLeft() / 60000)}m left`
        )
      }
    } catch (e) {
      console.warn(`[item] failed ${u}:`, e)
    }
  }

  emit()
}

main().catch((e) => { console.error(e); process.exit(1) })
