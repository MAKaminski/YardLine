/**
 * Counts published listings per HeavyTruckParts.net seller from the site's own
 * sitemap. This is the fragmentation measurement that drives /census concentration.
 *
 * Item URLs are /item/{Make}/{Model}/{PartType}/{account}/{branch}/{stockNo}.
 *
 * VERIFIED against live item pages 2026-08-02 (logged-out, public):
 *   254076/3  -> "LKQ Heavy Truck - Goodys", Toledo OH
 *   254076/24 -> "LKQ Evans Heavy Truck Parts", Athens GA
 *   1821960/1 -> "Vander Haags Inc SP", Spencer IA
 *
 * So {account} is the CORPORATE parent and {branch} is one of its yards; a
 * unique selling location is the PAIR. Both are reported: corporate-level
 * concentration answers "is this market many independent sellers?", while
 * location-level counts are what a single yard record carries.
 *
 * robots.txt allows the sitemap explicitly and sets Crawl-delay: 4 — honored below.
 * We send no `page=` parameter, so the `*?*page=*` disallow is never touched.
 * Facts only: we count URLs. No titles, descriptions, or images are read.
 *
 * Output: data/htp-listing-counts.json  { vendorId: count, ... }
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

const UA = 'YardLineBot/0.1 (+mailto:michael@modularequity.com)'
const DELAY = 4000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const idx = await fetch('https://www.heavytruckparts.net/sitemap_index.xml', {
    headers: { 'User-Agent': UA },
  })
  const xml = await idx.text()
  const maps = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  console.log(`[htp-counts] ${maps.length} sitemaps`)

  const byLocation: Record<string, number> = {} // "account:branch"
  const byAccount: Record<string, number> = {}
  let items = 0

  for (const [i, url] of maps.entries()) {
    await sleep(DELAY)
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      if (!res.ok) { console.warn(`[htp-counts] ${url} HTTP ${res.status}`); continue }
      const buf = Buffer.from(await res.arrayBuffer())
      const body = url.endsWith('.gz') ? gunzipSync(buf).toString('utf8') : buf.toString('utf8')
      for (const m of body.matchAll(/\/item\/[^<\s]+/g)) {
        const seg = m[0].split('/')
        const account = seg[seg.length - 3]
        const branch = seg[seg.length - 2]
        if (/^\d+$/.test(account) && /^\d+$/.test(branch)) {
          byLocation[`${account}:${branch}`] = (byLocation[`${account}:${branch}`] || 0) + 1
          byAccount[account] = (byAccount[account] || 0) + 1
          items++
        }
      }
      console.log(`[htp-counts] ${i + 1}/${maps.length} — ${items} items, ${Object.keys(byAccount).length} accounts, ${Object.keys(byLocation).length} locations`)
    } catch (e) {
      console.warn(`[htp-counts] ${url} failed:`, e)
    }
  }

  const accounts = Object.entries(byAccount).sort((a, b) => b[1] - a[1])
  const locations = Object.entries(byLocation).sort((a, b) => b[1] - a[1])
  const total = accounts.reduce((s, [, n]) => s + n, 0)
  const share = (arr: Array<[string, number]>, k: number) =>
    total ? Math.round((100 * arr.slice(0, k).reduce((s, [, n]) => s + n, 0)) / total) : 0

  const summary = {
    measured_at: new Date().toISOString(),
    total_listings: total,
    corporate_accounts: accounts.length,
    seller_locations: locations.length,
    top1_account_share_pct: share(accounts, 1),
    top5_account_share_pct: share(accounts, 5),
    top20_account_share_pct: share(accounts, 20),
    top20_location_share_pct: share(locations, 20),
    top_accounts: accounts.slice(0, 10),
  }

  mkdirSync(join(process.cwd(), 'data'), { recursive: true })
  writeFileSync(join(process.cwd(), 'data', 'htp-listing-counts.json'), JSON.stringify(byLocation, null, 2))
  writeFileSync(join(process.cwd(), 'data', 'htp-concentration.json'), JSON.stringify(summary, null, 2))

  console.log('\n' + JSON.stringify(summary, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })
