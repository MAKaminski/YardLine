# BACKLOG

Ranked. Top item is census-critical.

## 1. Rep can't see a yard's phone from inside the intake form
`app/yards/[id]/intake/page.tsx` shows eleven questions but never the yard's
number or a Call button, so a rep mid-call has to navigate away to redial or
check who they're talking to. Add a sticky header with the yard name, a `tel:`
Call button, and the digits.

## 2. No "Next yard" control; Today loses scroll position
`app/yards/[id]/page.tsx` has no way to advance to the next call. Going back
remounts `app/page.tsx`, refetches, and drops the rep to the top of the list —
forty times a morning that is real friction. Add a "Next ▸" link and preserve
scroll (or keep the list in a context/store).

## 3. Map plots the wrong companies
Only 5 of 12 yards have coordinates, and they are disproportionately the OEM
dealers — several independent salvage yards geocoded to null, so they never
appear as pins. The distance-sorted table lists them under "distance unknown".
Fix: geocode the misses (Nominatim failed on a few addresses; try the
"<city>, GA" fallback), or let a rep drop a pin.

## 4. Yard phone/address are not editable in the app
A rep who learns the real number has nowhere to correct the record — only
contacts can be added. Add inline edit for `phone` and `address` on
`app/yards/[id]/page.tsx`.

## 5. Only 12 yards, and only ~7 are independent salvage yards
The rest are OEM franchise dealers (Rush ×3, Peterbilt of Atlanta, Nextran)
which will not push a salvage feed, plus LKQ Evans — the incumbent this thesis
is trying to route around. A rep told to make 40 calls will exhaust the real
list quickly. The "+ Add yard" button now lets them extend it, but the seeder
should also be re-run against sources not yet exhausted:
- 9 of the 20 permitted web-search queries remain.
- `findtruckservice.com`, `yelp.com` returned **403** — blocked, skipped per
  SCRAPING_POLICY.md. Do not bypass; a human may read them manually.
- Georgia Secretary of State registry filtered by NAICS 423140.

**Note on market size:** thin coverage is partly real. HeavyTruckParts.net's own
Atlanta page lists exactly four GA yards (Forest Park, Cartersville, Jackson,
Athens) out of the 149 yards it says are actively selling nationwide.

## 6. Move off the shared Supabase project
YardLine's tables live in the `supabase-emerald-island` project because the
account was at its 2-active-free-project cap. See HANDOFF.md → "Database".

## 7. No offline queue for dispositions
The intake form survives signal loss (localStorage), but a disposition tap that
fails only surfaces an inline error. Queue failed writes and retry.

## 8. Playwright smoke test
`MANUAL_SMOKE.md` was executed by hand against production. A real Playwright
spec should replace it.

---

## Resolved 2026-08-02

- ~~HeavyTruckParts.net seller id~~ — resolved by reading live item pages. The
  URL's 3rd-to-last segment is the corporate account, 2nd-to-last is the branch.
  Measured: 829,525 listings / 97 corporate sellers / 128 locations; top-20
  share **86%**. `/census` now publishes it.
- ~~Deploy~~ — live at https://yard-line.vercel.app.
- ~~Intake silently un-completing itself~~ — the debounced autosave issued a
  full-row upsert including `completed_at: null`, which could land after
  `complete()` and blank the timestamp, dropping the call from every census
  metric. Reproduced against the database (`wiped: true`), fixed by stripping
  `completed_at`/`completed_by` from the autosave payload and cancelling the
  pending timer, re-verified (`wiped: false`).
- ~~Callbacks dated tomorrow~~ — a callback is now due today.
- ~~Worked yards vanishing from Today~~ — `contacted` stays on the call list.
- ~~No way to add a yard~~ — "+ Add yard" writes to `yards` as `rep_manual`.
- ~~Contacts read-only~~ — inline add-contact form.
- ~~One-tap accidental kill~~ — "Not interested" now confirms.
- ~~Phone not visible on the call list~~ — printed on every card.
