/**
 * Counts published listings per HeavyTruckParts.net seller from the site's own
 * sitemap. This is the fragmentation measurement that drives /census concentration.
 *
 * Item URLs are /item/{Make}/{Model}/{PartType}/{partCode}/{storeId}/{stockNo}.
 * The SELLER is {storeId} (2nd-to-last), matching `store=N` on /vendors.php.
 * NOTE: {partCode} (3rd-to-last) is NOT a seller id — 254076 is shared by both
 * LKQ Evans (store 24) and Maryland Truck (store 2). Keying on it double-counts
 * sellers and produces a bogus concentration figure.
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

  const counts: Record<string, number> = {}
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
        const vendor = seg[seg.length - 2]
        if (/^\d+$/.test(vendor)) { counts[vendor] = (counts[vendor] || 0) + 1; items++ }
      }
      console.log(`[htp-counts] ${i + 1}/${maps.length} — ${items} items, ${Object.keys(counts).length} vendors`)
    } catch (e) {
      console.warn(`[htp-counts] ${url} failed:`, e)
    }
  }

  mkdirSync(join(process.cwd(), 'data'), { recursive: true })
  writeFileSync(join(process.cwd(), 'data', 'htp-listing-counts.json'), JSON.stringify(counts, null, 2))

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
  const total = sorted.reduce((s, [, n]) => s + n, 0)
  const top20 = sorted.slice(0, 20).reduce((s, [, n]) => s + n, 0)
  console.log(`\n[htp-counts] total indexed listings: ${total}`)
  console.log(`[htp-counts] sellers: ${sorted.length}`)
  console.log(`[htp-counts] top-20 share: ${total ? Math.round((100 * top20) / total) : 0}%`)
  console.log('[htp-counts] top 10:', sorted.slice(0, 10))
}

main().catch((e) => { console.error(e); process.exit(1) })
