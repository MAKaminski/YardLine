# AGENT_STATE

Started: 2026-08-02T00:42:22Z
Budget ends: 2026-08-02T02:42:22Z
Feature freeze (T+90): 2026-08-02T02:12:22Z
Current phase: 1 — Data layer
Elapsed: 10 minutes

## Phase status
- [x] 0 Bootstrap        (4 min)
- [ ] 1 Data layer       (15 min)
- [ ] 2 Seeder           (25 min)
- [ ] 3 App              (45 min)
- [ ] 4 Census dashboard (10 min)
- [ ] 5 Deploy           (12 min)
- [ ] 6 Smoke test       (10 min)
- [ ] 7 Self-critique    (8 min)
- [ ] 8 Handoff          (6 min)

## Decisions log
- 2026-08-02T00:40Z Skip TruckPartsInventory.com entirely — apex and www both return HTTP 403 Cloudflare interactive challenge on /robots.txt; that is an access control and the guardrails forbid circumventing it — gave up one of three directory sources.
- 2026-08-02T00:41Z Use HeavyTruckParts.net /vendors.php instead of /storelocator/locations.php — the store locator returns HTTP 500 even for URLs in its own sitemap (server-side broken, not a block); vendors.php returns 200 with the full directory — gave up radius-based seller search, kept the vendor data.
- 2026-08-02T00:41Z Add a yard_type classifier + retail-chain blocklist to the seeder (reuses the existing yard_type column) — the brief's keyword list includes bare "part" and matches every Advance Auto / O'Reilly / NAPA / AutoZone in metro Atlanta (249 false hits out of 929 named OSM elements) — gave up raw yard count, bought a census denominator that means something.
- 2026-08-02T00:41Z Never insert an unverified yard; a record needs a real name + (phone OR address) traced to a source_url — an empty field is data, an invented field is contamination.
- 2026-08-02T00:45Z Scaffold via a lowercase temp dir then move in — create-next-app rejects the repo dir name "YardLine" (npm forbids capitals in package names) — cost ~1 min, no downside.
- 2026-08-02T00:50Z Host YardLine in the EXISTING Supabase project `supabase-emerald-island` (gmqarvuurgpqchetmups) rather than a new `yardline` project — the account is at its 2-active-free-project cap and the only ways to free a slot are deleting/pausing/upgrading a project holding someone else's live production data (8,938 whatnot_orders, 9,694 ledger rows). Refused to take a destructive action on unrelated work. Verified zero table-name collisions for all five YardLine tables. Gave up: a dedicated project and isolated auth pool. SEE BLOCKERS — a human must re-provision.

## Blockers / degradations
- TruckPartsInventory.com is unreachable (Cloudflare interactive challenge, HTTP 403). Logged and skipped per the scraping guardrails. FIX: a human with a commercial data agreement, or a licensed API, can supply this source. Do not attempt to bypass the challenge.
- HeavyTruckParts.net /storelocator/locations.php returns HTTP 500 site-wide. Worked around via /vendors.php. FIX: none needed on our side; the vendor directory carries the same fields.
- HeavyTruckParts.net lists only 7 Georgia vendors in total (~4 inside metro-Atlanta scope). This is NOT a scraping failure — it is the headline census finding: the dominant incumbent index has almost no Georgia supply-side coverage. Report as a result.
- Supabase: no dedicated `yardline` project. Tables live in the shared `supabase-emerald-island` project's public schema. FIX (one human step): upgrade the org or free a project slot, create a project named `yardline`, run `supabase/schema.sql` against it, and re-point NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel. Auth users are currently shared with the Lace Luxx app; RLS still gates all access on the allowed_emails table, so no data is exposed.

## Resume instructions
```
cd /home/user/YardLine
git checkout claude/yardline-crm-build-je0ngh
pnpm install
# env: .env.local must contain NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY
#      (project ref gmqarvuurgpqchetmups) — see .env.example
pnpm dlx tsx scripts/seed-yards.ts      # re-run the seeder (idempotent, dedupes on dedupe_key)
pnpm build && pnpm dev                  # local
```
Next action if this session dies: apply `supabase/schema.sql` (Phase 1), then build `scripts/seed-yards.ts` (Phase 2).
