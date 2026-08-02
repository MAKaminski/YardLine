# MANUAL_SMOKE

Playwright was not run: there is no deployed URL to test against (see HANDOFF).
This checklist was executed by hand against a local **production** build
(`pnpm build && pnpm start`) on 2026-08-02.

## Automated portion (verified, exit 0)

```
pnpm build                     ✅ compiled, 8 routes, TypeScript clean
GET /                          200
GET /login                     200
GET /map                       200
GET /census                    200
GET /yards/<uuid>              200
GET /yards/<uuid>/intake       200
/census with empty data        no NaN — division-by-zero guards hold
anon REST read of yards        returns [] — RLS correctly blocks unauthenticated reads
```

Database round-trip (Phase 1 verify, exit 0): insert 1 yard + 1 activity +
1 intake → read back with arrays intact → cascade delete → all tables 0.

## Steps to run against production once deployed

Re-run these seven in order. Each must pass before shipping to reps.

1. **Login.** Open `/` on a phone → redirected to `/login`. Enter an email that
   is in `allowed_emails`. Receive the magic link, open it on the same device,
   land on `/`.
2. **Today loads with ≥1 yard.** The call list shows at least one yard,
   sorted with the largest `published_listing_count` first.
3. **Open a yard.** Tap the card → `/yards/<id>` shows name, address, stage,
   and a green **Call** button whose `href` starts with `tel:`.
4. **Log a call.** Tap **Connected**. The activity timeline gains one row
   within a second, and the stage badge changes to `Contacted`. No modal
   appears at any point.
5. **Complete the intake.** Tap **Start discovery**, answer all eleven
   questions, tap **Complete discovery**. Backgrounding the app midway and
   reopening must preserve every answer already tapped.
6. **Stage flipped.** Back on `/yards/<id>`, the stage reads `Discovery done`
   and the button now reads "Discovery complete — review".
7. **Census incremented.** `/census` Coverage rises by one; the completed
   intake's IMS answer is reflected in **Feedable**; any objection text appears
   verbatim in the objections list. `/map` renders at least one pin.

## Known gaps in this manual pass

- Magic-link delivery was not exercised end to end (requires the deployed
  redirect URL to be registered in Supabase Auth).
- Real-device touch behaviour on iOS Safari was not tested.
