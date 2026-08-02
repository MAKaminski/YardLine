# BACKLOG

Ranked. Top item is census-critical.

## 1. Resolve the HeavyTruckParts.net seller id — blocks the concentration metric
**Why it matters:** concentration is the number that decides whether the
aggregator business exists. We can enumerate ~830k listing URLs from the public
sitemap, but not yet attribute them to sellers.

Item URLs look like:
`/item/{Make}/{Model}/{PartType}/{A}/{B}/{stockNo}` — e.g.
`/item/Freightliner/Coe/Front-End-Assembly/742607/1/761`

Neither candidate holds up:
- `{A}` (3rd-to-last) — matches the `fltpc` on `/vendors.php`, but **254076 is
  shared by LKQ Evans (store 24) and Maryland Truck (store 2)**, so it is a part
  code, not a seller. Keying on it yields a bogus "97 sellers / 86% top-20".
- `{B}` (2nd-to-last) — matches `store=N`, but yields only 18 distinct values
  with store 1 holding 407k listings, which would mean one small Forest Park
  yard holds half the national index. Not credible.

**Task (~1 hour):** open 3–4 known item URLs from different vendors logged-out
and read which id actually corresponds to the selling dealer shown on the page.
Then fix the segment index in `scripts/htp-listing-counts.ts`, re-run, and
re-seed. `data/htp-listing-counts.UNVERIFIED.json` holds the bad output — delete
it once corrected.

Until then `published_listing_count` stays `null` and `/census` shows the
concentration tile as "—" with an explicit "not yet measured" note. **Do not
publish a concentration figure until this is resolved.**

## 2. ~~Deploy to Vercel~~ — DONE, but allowlist the redirect URL
Live at **https://yard-line.vercel.app**, git-connected, auto-deploys on push.

**Still required (~2 min):** add `https://yard-line.vercel.app/auth/callback`
to Supabase → Authentication → Redirect URLs, and set Site URL to the same
origin. Without it GoTrue falls back to `http://localhost:3000` and every magic
link breaks. Could not be set or read from the build environment — see
HANDOFF.md.

## 3. Get the yard count above 10
Only 10 in-scope yards are seeded. This is partly a real finding (see HANDOFF)
and partly incomplete discovery. Sources not yet exhausted:
- The bounded web search used 5 of its 20 queries.
- `findtruckservice.com` and `yelp.com` both returned **403** — blocked, so
  skipped per SCRAPING_POLICY.md. Do not bypass; a human can read them manually.
- Georgia Secretary of State business registry (open data) filtered by NAICS
  423140 (Motor Vehicle Parts, Used) would likely add real yards with addresses.
- Trade associations: ATRI, Automotive Recyclers Association GA chapter.

## 4. Move off the shared Supabase project
YardLine's tables live in the `supabase-emerald-island` project because the
account was at its 2-active-free-project cap. See HANDOFF.md → "Database".

## 5. Contacts are read-only in the UI
The `contacts` table and its RLS policy exist and the yard page renders
contacts, but there is no "add contact" form — a rep who learns the parts
manager's name has nowhere to type it. Add a one-field inline form on
`/yards/[id]`. (Deferred under the brief's stated cut order.)

## 6. No offline queue
If a rep loses signal in a yard's back lot, a disposition tap fails and the
error only shows inline. The intake form survives this (localStorage), but
activity logging does not. Queue failed writes in localStorage and retry.

## 7. Playwright smoke test not run
`MANUAL_SMOKE.md` documents the seven-step path and it was executed by hand
against a local production build. A real Playwright spec against the deployed
URL should replace it once item 2 lands.
