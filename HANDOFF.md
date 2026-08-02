# YardLine — HANDOFF

Built 2026-08-02 in a 2-hour window. **LIVE:** https://yard-line.vercel.app

Read the ⚠️ item first — it is the one thing standing between reps and a
working login.

---

## ⚠️ ONE STEP LEFT: allowlist the redirect URL in Supabase (2 minutes)

**Do this before reps start calling, or every magic link will break.**

Supabase → **Authentication → URL Configuration**:

- **Site URL:** `https://yard-line.vercel.app`
- **Redirect URLs:** add `https://yard-line.vercel.app/auth/callback`

The app requests `emailRedirectTo = <origin>/auth/callback`. If that URL is not
on the allowlist, GoTrue silently falls back to the Site URL — which defaults
to `http://localhost:3000`, so a rep tapping the link on their phone lands
nowhere.

I could not verify or set this from the build environment: there is no Supabase
MCP tool for auth configuration, and the REST API accepted a deliberately bogus
`redirect_to` with HTTP 200, so it gives no signal either way. **Assume it is
unset until you have looked.**

---

## Deployment status: LIVE ✅

| | |
|---|---|
| Production URL | https://yard-line.vercel.app |
| Vercel project | `yard-line` (`prj_PwXxQ9FHgYVFKa2HHxGeItbUeEZl`) |
| Deployment | `dpl_2FVmNhiuBCATZQ71Bo9wrrRNgK4X`, state READY, target production |
| Source | git-connected, auto-deploys on push to `claude/yardline-crm-build-je0ngh` |

Verified against production after the env fix:

```
/                          200
/login                     200   (renders the real app; no Vercel SSO wall)
/map                       200
/census                    200
/yards/<id>                200
/yards/<id>/intake         200
/auth/callback (no code)   307 → /login?error=link_expired
anon REST read of yards    200 []   ← RLS correctly blocks unauthenticated reads
NEXT_PUBLIC_SUPABASE_URL   present in the client bundle
```

### Note on env vars
The connected project had **no environment variables**, so the first deployment
shipped a client bundle with no Supabase URL — login would have failed for
everyone. The two `NEXT_PUBLIC_*` values now live in a committed
`.env.production`. They are compiled into the browser bundle by design, and the
anon key is inert without an `allowed_emails`-backed session (proved by the
empty anonymous read above). If you'd rather keep them in the Vercel dashboard,
set them there and delete `.env.production`.

### Note on deployment protection
The project has Vercel Authentication enabled for
`all_except_custom_domains`. Empirically the production alias
`yard-line.vercel.app` is **not** gated — it returns our app, 200, with no SSO
markers. Per-deployment preview URLs (`yard-line-<hash>-…`) are gated, so send
reps the clean `yard-line.vercel.app` link, not a deployment-specific one.

---

## ⚠️ Database lives in a shared Supabase project

The account was at its **2-active-free-project cap**, and the only way to free a
slot was deleting or pausing a project holding someone else's live production
data (8,938 order rows, 9,694 ledger rows). That was not a call to make
unattended, so YardLine's five tables were created inside the existing
`supabase-emerald-island` project (ref `gmqarvuurgpqchetmups`).

- No table-name collisions — all five names were free.
- Nothing belonging to the other app was read or modified.
- RLS still gates every row on `allowed_emails`, so no data is cross-exposed.
- Auth users are shared with that project's auth pool.

**To fix:** free a project slot or upgrade the org, create a project named
`yardline`, run `supabase/schema.sql` against it verbatim, re-seed with
`supabase/seed-yards.sql`, and re-point the two env vars.

---

## How a rep logs in

1. Open the app on their phone.
2. Type their work email → **Send magic link**.
3. Open the email on that same phone. Done — the session persists.

Access is gated on the `allowed_emails` table. Currently seeded with
`michael@modularequity.com` plus `rep1@example.com` … `rep4@example.com`
placeholders.

### Add a rep (one line, Supabase SQL editor)

```sql
insert into allowed_emails (email) values ('newrep@company.com') on conflict do nothing;
```

---

## Rep quickstart — the six steps of a call

1. Open **Today**. The list is sorted by published inventory, biggest first.
2. Tap **Call**. It dials — every number in the app is a real `tel:` link.
3. Ask for whoever runs the parts counter or the yard.
4. Tap one disposition button. One tap, no popup, and the stage moves itself.
5. If you got a real conversation, tap **Start discovery** and work the eleven
   questions top to bottom. Roughly four minutes.
6. Tap **Complete discovery**. That yard flips to `discovery_done`.

**Why the discovery questions matter — read this to the team:**

> We are not selling anything on these calls. We are finding out whether a live
> parts feed is even buildable in this market, and the only people who know are
> the ones answering the phone. A call with no intake tells us nothing; skipping
> question 2 (what they track inventory with) throws away the single best
> predictor of whether a yard can ever send us a feed.

The intake autosaves on every tap and keeps a local copy, so backgrounding the
app, taking another call, or losing signal will not lose answers.

---

## What the seeder found

**10 in-scope yards, 9 with a phone number (90%), zero fabricated records.**

This is short of the 25-yard target, and the shortfall is itself the most
useful thing the seeder produced.

| Source | Yards | Notes |
|---|---|---|
| OpenStreetMap (Overpass) | 5 | after strict HD filtering |
| HeavyTruckParts.net | 2 | the entire in-scope yield of the incumbent directory |
| Verified from company websites | 3 | each checked against the business's own site |

Geographic spread: Bartow, Clayton, Cobb, Fulton, plus Ellenwood, Jackson,
Gainesville and Athens. Split by type: 5 `hd_salvage`, 5 `oem_dealer`.

### The findings that matter more than the count

1. **HeavyTruckParts.net — the dominant industry index — lists only 6 vendors in
   the entire state of Georgia.** Two are inside metro Atlanta. Independent
   corroboration: the site's own store locator reports "6 semi truck salvage
   yards within 150 miles of Atlanta." Supply-side coverage in this market is
   genuinely thin, not merely hard to scrape.

2. **The obvious keyword approach produces garbage.** Filtering metro-Atlanta
   OSM on the originally specified keywords returned 249 "matches" out of 929
   named businesses — almost all Advance Auto Parts, O'Reilly, NAPA and
   AutoZone, because the list included the bare token `part`. Seeding those
   would have hit the 25-yard bar while handing reps a morning of calling retail
   chains and destroying the census denominator. The seeder now classifies every
   candidate (`hd_salvage` / `oem_dealer` / `scrap_metal` / `retail_chain`) and
   inserts only the first two.

3. **Concentration is not yet measurable.** See BACKLOG item 1. A wrong number
   here would misdecide the business case, so `/census` shows "—" and says so
   plainly rather than publishing a figure that cannot be substantiated.

Every record traces to a `source_url`. Nothing was invented.

---

## Degraded or skipped

| What | Why | Fix |
|---|---|---|
| ~~Production deploy~~ | RESOLVED — live at https://yard-line.vercel.app | — |
| **Supabase redirect allowlist** | could not be set or read from the build environment | 2-minute dashboard step at the top of this file |
| **Dedicated Supabase project** | free-project cap; refused to pause a stranger's production DB | See "Database" above |
| **TruckPartsInventory.com** | HTTP 403 Cloudflare interactive challenge = access control | Commercial data agreement or licensed API. **Do not bypass** — see SCRAPING_POLICY.md |
| **findtruckservice.com, yelp.com** | HTTP 403 | Blocked; skipped per policy. A human may read them manually |
| **HTP store locator** | HTTP 500 site-wide, even on its own sitemap URLs | Worked around via `/vendors.php` |
| **`published_listing_count`** | seller-id segment ambiguous | BACKLOG item 1 |
| **≥25 yards** | only 10 verified in scope | BACKLOG item 3 — partly a real market finding |
| **Playwright smoke test** | no deployed URL to test against | `MANUAL_SMOKE.md` run by hand instead |
| **Self-critique pass (Phase 7)** | ran out of clock; first item in the stated cut order | Run it post-deploy |
| **shadcn/ui** | skipped the CLI to avoid a Tailwind v4 / React 19 fight; hand-rolled Tailwind components | cosmetic only |
| **Add-contact form** | cut per the brief's cut order | BACKLOG item 5 |

---

## Repo map

```
app/                     routes: / /login /map /census /yards/[id] /yards/[id]/intake
components/AuthGate.tsx  session guard + bottom tab bar
components/YardMap.tsx   Leaflet, dynamically imported (ssr:false)
lib/types.ts             stages, dispositions, census vocabularies
supabase/schema.sql      full schema, RLS, triggers — apply verbatim to a new project
supabase/seed-yards.sql  generated upserts, idempotent on dedupe_key
scripts/seed-yards.ts    the seeder
scripts/htp-listing-counts.ts  listing counter (see BACKLOG item 1)
data/verified-yards.json human/agent-verified yards, each with its source
SCRAPING_POLICY.md       legal guardrails + the block-and-skip decisions
AGENT_STATE.md           build log, decisions, blockers
BACKLOG.md               ranked remaining work
```

Re-run the seeder any time — it dedupes on `dedupe_key` and merges rather than
duplicating:

```bash
pnpm dlx tsx scripts/seed-yards.ts
```
