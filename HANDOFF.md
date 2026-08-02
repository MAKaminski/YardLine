# YardLine — HANDOFF

Built 2026-08-02 in a 2-hour window. **LIVE:** https://yard-line.vercel.app

Read the ⚠️ item first — it is the one thing standing between reps and a
working login.

---

## ⚠️ EMAIL IS THE CONSTRAINT — read before the team starts

Auth uses Supabase's **built-in** email sender, which is capped at
**2 emails per hour for the whole project**. Custom SMTP via Resend was tried
and rolled back (see below). Supabase automatically reset the rate-limit field
from 30 back to `2/1h` the moment custom SMTP was disabled.

**Five reps cannot log in cold at 7:45am.** The first two get links; the rest
get an error.

### The plan that works: log everyone in the night before

Supabase sessions persist across app restarts and last well beyond a single
day. Have each rep sign in the evening before, spaced ~30 minutes apart, and
they will still be signed in the next morning with no email involved.

### The permanent fix: custom SMTP

A Resend account is already set up and verified for this:

- Domain `modularequity.com` — verified, sending enabled
- Two sending-only API keys exist, named *YardLine Supabase SMTP* and
  *YardLine SMTP unrestricted*
- A test send from `yardline@modularequity.com` delivered successfully, so the
  Resend side is known good

It was rolled back because Supabase returned
`535 "Authentication credentials invalid"` on every send. Resend's SMTP
username must be the **literal string `resend`** — not the sender address, not
the API key. That is the most likely cause and was never re-tested.

To retry, at
https://supabase.com/dashboard/project/gmqarvuurgpqchetmups/settings/auth
→ SMTP Settings:

| Field | Value |
|---|---|
| Host | `smtp.resend.com` |
| Port | `587` |
| Username | `resend` (literal, lowercase) |
| Password | a Resend API key, re-pasted cleanly |
| Sender email | `yardline@modularequity.com` |
| Sender name | `YardLine` |

Then raise **Rate Limits → emails per hour**; it does not stick while custom
SMTP is off.

### 🔴 This Supabase project is shared with Lace Luxx

Auth logs show `/otp` requests from `https://www.lace-luxx.com/` on the same
GoTrue instance. **Any SMTP change here changes Lace Luxx's auth email too** —
the broken 535 config took down Lace Luxx logins as well until it was rolled
back. Verify both apps after any auth change. A dedicated YardLine project
removes this coupling permanently (see "Database" below).

### Redirect URL — done
`https://yard-line.vercel.app/auth/callback` is allowlisted and working; failing
requests carried it as referer with no invalid-redirect error.

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

## Two ways to collect a census row

### 1. By phone (v1)
The six-step call flow below. Highest-quality evidence — a rep verified it.

### 2. By link, no call (v2)
Every yard has a permanent tokenized URL. Nobody logs in, no account, no
password, and **it does not touch Supabase auth email**, so it is unaffected by
the 2-emails/hour limit.

- `/i/<public_token>` — the same eleven census questions, self-serve.
- `/v/<public_token>` — the vendor price tool (below). This is the *hook*: lead
  with what their parts are worth, then ask the eleven questions.

On any yard page there is now an email field and an **Email intake** button.
It sends the link via the Resend API. If `RESEND_API_KEY` is not configured it
instead opens the rep's own mail client with the message prefilled, so the
feature works with zero setup.

Answers arriving this way are stored with `completed_via='self_serve'` and
`/census` reports them **separately** from rep-verified rows. A yard answering
its own survey is weaker evidence than a rep on the phone; do not blur them.

---

## The vendor price tool — what makes a yard answer

`/v/<public_token>` gives a yard something before asking for anything:

- **Look up a part** — make / model / part type returns median, 25th, 75th
  percentile and n, plus the actual comparable listings. Every price links back
  to the listing it came from.
- **Price my list** — the yard pastes up to 40 lines of inventory and gets an
  indicative value.

That second box is the most important instrument in the whole product. A yard
that pastes a real parts list has *demonstrated* it will hand inventory over —
revealed preference, which is a far stronger feed signal than answering "yes" to
question 8. `/census` counts these under **Handed over inventory**.

### What's in the index right now
**1,808 priced listings**, 67 makes, 133 part types, collected 2026-08-02 over
two crawl runs.

| Family | Listings | Median | Range |
|---|---:|---:|---|
| transmissions | 206 | $1,250 | $34 – $15,000 |
| rears/differentials | 197 | $1,067 | $13 – $4,500 |
| engines | 175 | $2,750 | $5 – $45,000 |
| electronics/ECMs | 163 | $400 | $40 – $2,500 |
| cabs | 110 | $2,000 | $50 – $13,250 |
| hoods | 109 | $1,350 | $40 – $5,500 |
| aftertreatment/DPF | 81 | $400 | $8 – $6,500 |
| axles/suspension | 59 | $1,000 | $73 – $3,800 |
| turbos | 36 | $475 | $71 – $4,140 |
| other | 672 | $400 | $200 – $6,850 |

Live examples it answers today:
- **Detroit engines** — n=33, median **$6,350** (p25 $2,500 / p75 $7,850); a
  2014 DD15 assembly lists at $14,000
- **Transmissions, all makes** — n=211, median **$1,250** (p25 $800 / p75 $1,835)
- **Freightliner hoods** — n=25, median **$1,475**

**Read medians, not extremes.** Family is assigned from the part-type slug, so
"Engine Mount" lands in `engines` alongside "Engine Assembly" — which is why the
engine range starts at $5. The medians are sound; the min/max are not a price
range for a whole unit. A thin `n` means directional only.

### Where the prices come from
Mirrored public listing facts from HeavyTruckParts.net item pages: year, make,
model, part type, price, stock number, seller city/state, availability, and the
source URL. **No descriptions, no photographs.** `Crawl-delay: 4` honored. See
SCRAPING_POLICY.md → "Price index".

The index is a **sample, not the whole market**, and the vendor page says so on
screen with the live count and collection date. Refresh or extend it with:

```bash
pnpm dlx tsx scripts/collect-prices.ts --minutes=60
# then apply supabase/seed-parts.sql
```

Re-runs are idempotent (unique on source + stock number) and the sitemap is
cached, so a second run spends all its time on new pages.

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

**12 in-scope yards, 11 with a phone number (92%), zero fabricated records.**

Still short of the 25-yard target, and the shortfall is itself the most useful
thing the seeder produced.

| Source | Yards | Notes |
|---|---|---|
| OpenStreetMap (Overpass) | 5 | after strict HD filtering |
| HeavyTruckParts.net | 2 | the entire in-scope yield of the incumbent directory |
| Verified from company websites | 5 | each checked against the business's own site |

Split by type: **7 `hd_salvage`, 5 `oem_dealer`**. Be honest with the team about
that second number — Rush Truck Centers (×3), Peterbilt of Atlanta and Nextran
are OEM franchise dealers and will not hand a startup a salvage feed. The Today
view now has a yard-type filter so a rep can hide them. The genuinely
independent list is short, which is the finding.

Rejected during verification (worth knowing, so nobody re-adds them): Rydemore
(a Massachusetts company with an Atlanta SEO landing page — no local yard),
Atlanta Truck Equipment (construction/mining equipment), FleetPride (new-parts
distributor), Southern Auto Salvage and McDonough Used Auto Parts (light auto,
not HD).

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

3. **Concentration: 86% — the market is NOT fragmented.** Measured from the
   incumbent's own public sitemap after confirming seller identity against live
   item pages (the URL's 3rd-to-last segment is the corporate account, the
   2nd-to-last is one of its branches).

   HeavyTruckParts.net publishes **829,525 listings from 97 corporate sellers
   across 128 yard locations**. One company (LKQ) holds **30%**; the top five
   hold **67%**; the top twenty hold **86%**.

   Against the stated threshold — ">70% means we are reselling one incumbent's
   index, not aggregating a market" — this lands clearly on the wrong side.
   Aggregating this index means reselling LKQ and Vander Haag's. That is the
   single most important number the build produced, and it argues against the
   aggregator thesis as originally framed.

   Local counts tell the same story: LKQ Evans (Athens) 39,853 listings, Crest
   (Cartersville) 12,070, HD Truck (Jackson) 1,645, Forest Park Tractor &
   Trailer 58.

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
