# SCRAPING_POLICY

These are legal guardrails, not style preferences. The seeder
(`scripts/seed-yards.ts`) implements them; any future collector must too.

## Rules

1. **Logged-out, publicly accessible pages only.** No accounts, no credentials,
   no paywall bypass.
2. **Never circumvent an access control.** No CAPTCHA solving, no proxy
   rotation to defeat blocks, no identity masking. If a host blocks us, log it
   and skip it.
3. **Honor `robots.txt` and any `Crawl-delay`.** Default to 4 seconds between
   requests to the same host, single-threaded per host.
4. **Set a descriptive, honest User-Agent** identifying the crawler and a
   contact email: `YardLineBot/0.1 (+mailto:michael@modularequity.com)`.
5. **Ingest facts only** — name, address, phone, URL, listing counts,
   timestamps. Never copy photographs, marketing prose, or listing
   descriptions. Store `source_url` on every record for attribution.

## Applied decisions (2026-08-02)

### TruckPartsInventory.com — BLOCKED, SKIPPED
`https://truckpartsinventory.com/robots.txt` and the `www.` host both return
**HTTP 403** with a Cloudflare interactive challenge page ("Just a moment...").

That is an access control. Rule 2 applies: **we did not attempt to solve the
challenge, rotate IPs, or spoof a browser identity.** The source is logged here
and excluded from the seeder. Do not "fix" this by bypassing the challenge.

The legitimate paths forward are a commercial data agreement with the site
owner, or a licensed API. Both are human decisions, not crawler decisions.

### HeavyTruckParts.net — ALLOWED, USED
`robots.txt` returns 200 and states:

```
User-agent: *
Crawl-delay: 4
Disallow: /scripts/
Disallow: /myinv/
Disallow: /partinquiry
Disallow: /estimates/
Disallow: *?*page=*
Sitemap: https://www.heavytruckparts.net/sitemap_index.xml
```

No AI-bot restriction and no bulk-extraction clause. We honor it as follows:

- 4-second delay between requests, single-threaded.
- We fetch `/vendors.php` (the public vendor directory) and
  `/search.php?fltpc=<id>&store=<N>` for per-seller listing counts.
- **We never send a `page=` parameter**, so we never touch the
  `*?*page=*` disallow. This means we read only the first result view per
  seller and take the reported total — we do not paginate through listings.
- We take facts only: vendor name, phone, street address, city/state/zip, the
  store id, and the reported listing count. We copy **no** part descriptions,
  photos, or vendor marketing blurbs.

Note: `/storelocator/locations.php` returns HTTP 500 for every query including
the URLs in the site's own sitemap. That is a server-side fault on their end,
not a block; we simply use `/vendors.php` instead.

### OpenStreetMap / Overpass API — ALLOWED, USED
Open data under ODbL. Attribution: "© OpenStreetMap contributors". No rate
limit issues at our volume (one bbox query per run).

### Nominatim (OSM geocoding) — ALLOWED, USED
Used only for records missing coordinates. Hard-limited to **1 request per
second** with the descriptive User-Agent above, per Nominatim's usage policy.

## Data integrity rule

**Never fabricate a yard, a phone number, or a listing count.** An empty field
is data; an invented field is contamination that poisons the census. If a value
cannot be traced to a `source_url`, it is stored as `null`.
