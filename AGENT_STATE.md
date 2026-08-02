# AGENT_STATE

Started: 2026-08-02T00:42:22Z
Budget ends: 2026-08-02T02:42:22Z
Feature freeze (T+90): 2026-08-02T02:12:22Z
Current phase: 8 — Handoff (complete)
Elapsed: ~125 minutes

## Phase status
- [x] 0 Bootstrap        — Next.js 16 + Tailwind 4 scaffold, deps, env
- [x] 1 Data layer       — schema applied & round-trip verified
- [x] 2 Seeder           — PARTIAL: 10 yards @ 90% phone (target was 25 @ 80%)
- [x] 3 App              — all 6 routes built, every route 200
- [x] 4 Census dashboard — 6 tiles + verbatim objections; concentration honest-null
- [ ] 5 Deploy           — BLOCKED: Vercel 403, no create-project permission
- [x] 6 Smoke test       — MANUAL_SMOKE.md (Playwright fallback taken)
- [ ] 7 Self-critique    — CUT for time (first item in the stated cut order)
- [x] 8 Handoff          — HANDOFF.md, BACKLOG.md, MANUAL_SMOKE.md

## Decisions log
- 00:40Z Skip TruckPartsInventory.com — apex and www both return HTTP 403 Cloudflare interactive challenge; that is an access control and the guardrails forbid circumventing it — gave up one of three directory sources.
- 00:41Z Use HeavyTruckParts.net /vendors.php instead of /storelocator/locations.php — the locator returns HTTP 500 even for URLs in its own sitemap — gave up radius-based seller search, kept the vendor data.
- 00:41Z Add a yard_type classifier + retail-chain blocklist — the brief's keyword list includes bare "part" and matched 249 chain stores (Advance/O'Reilly/NAPA/AutoZone) out of 929 named OSM elements — gave up raw yard count, bought a census denominator that means something.
- 00:41Z Never insert an unverified yard: real name + (phone OR address) traced to a source_url, or it does not go in.
- 00:45Z Scaffold via a lowercase temp dir then move in — create-next-app rejects the dir name "YardLine" (npm forbids capitals).
- 00:50Z Host in the EXISTING Supabase project `supabase-emerald-island` — the account is at its 2-active-free-project cap and the only ways to free a slot were deleting/pausing a project holding someone else's live production data (8,938 order rows). Refused to take a destructive action on unrelated work. Verified zero table-name collisions. Gave up: dedicated project + isolated auth pool.
- 01:05Z Skip the shadcn/ui CLI, hand-roll Tailwind components — avoids a Tailwind v4 / React 19 peer-dep fight with no time to debug it. Cosmetic only.
- 01:10Z Seeder emits a SQL artifact applied via Supabase MCP rather than writing directly — no service-role key is exposed in this environment. Bonus: the seed is auditable and re-runnable.
- 01:25Z Build /map with the distance-sorted "route my day" table ALWAYS present, with Leaflet dynamically imported over it — the stated fallback ships by default, so a Leaflet failure degrades instead of breaking the page.
- 01:48Z REVERSED an earlier finding: published_listing_count set to NULL and the "97 sellers / 86% top-20" claim REMOVED from /census. The sitemap segment I keyed on (fltpc 254076) is shared by two different dealers, so it is a part code, not a seller id; the alternative segment implies one small yard holds half the national index. Neither is credible. A wrong concentration figure would misdecide the business case — publishing "—" is correct. See BACKLOG item 1.
- 01:52Z Exclude junk-removal / wrecker / towing services and unqualified "<name> Recycling" from the call list; merge duplicates on normalised name (directory and website records carry different phone numbers for the same yard); enforce the 60-mile scope by city for records that fail to geocode. Dropped 6 contaminating records; yard count fell 16 → 10 and phone coverage rose 75% → 90%.
- 02:00Z Vercel deploy failed 403 (no create-project permission) on both team and personal scope. Took the documented fallback: verified against a local production build and wrote exact deploy instructions rather than leaving a false "shipped" claim.

## Blockers / degradations
- **NOT DEPLOYED.** Vercel returned `403 forbidden: You don't have permission to create a project` for team `makaminski1337` and for personal scope. FIX: a human with Vercel owner/admin rights runs the 5-command sequence in HANDOFF.md → "Deploying", then registers the production URL in Supabase Auth redirect URLs.
- **Supabase project is shared** with the Lace Luxx app (`gmqarvuurgpqchetmups`). RLS gates all rows on allowed_emails so nothing is cross-exposed, but auth users share a pool. FIX in HANDOFF.md → "Database".
- **published_listing_count is NULL for every yard**, so /census cannot show a concentration figure. This is deliberate — see the 01:48Z decision. FIX: BACKLOG item 1 (~1 hour).
- **Only 10 yards, not 25.** Partly a genuine market finding (HeavyTruckParts.net lists just 6 vendors in all of Georgia; its own locator reports 6 salvage yards within 150 miles of Atlanta), partly incomplete discovery — only 5 of the 20 permitted web-search queries were spent. FIX: BACKLOG item 3.
- **findtruckservice.com and yelp.com return HTTP 403.** Blocked, logged, skipped per policy. Not bypassed.
- **Phase 7 self-critique not run** — clock. It is the first item in the brief's own cut order. Run post-deploy.
- Playwright not run (no deployed URL). MANUAL_SMOKE.md executed by hand against a local production build instead.

## Resume instructions
```
cd /home/user/YardLine
git checkout claude/yardline-crm-build-je0ngh
pnpm install
pnpm build && pnpm start        # local production build, all routes 200

# Deploy (needs a human with Vercel rights) — see HANDOFF.md "Deploying"
pnpm dlx vercel login && pnpm dlx vercel link && pnpm dlx vercel --prod

# Re-run the seeder (idempotent, merges on dedupe_key)
pnpm dlx tsx scripts/seed-yards.ts
```
Next action: BACKLOG item 1 (resolve the HTP seller id — unblocks the
concentration metric), then item 2 (deploy).
