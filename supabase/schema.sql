-- YardLine schema
-- Supply-side prospecting CRM + market-census instrument for HD truck salvage yards.
--
-- NOTE: these tables currently live in a SHARED Supabase project because the account
-- was at its free-project cap (see AGENT_STATE.md Blockers). Nothing here references
-- or modifies any other application's tables. To move to a dedicated project, run this
-- file verbatim against the new project and re-point the env vars.

-- ---------------------------------------------------------------------------
-- stage enum: new -> attempted -> contacted -> discovery_done -> feed_agreed -> live -> dead
-- ---------------------------------------------------------------------------
do $$ begin
  create type yard_stage as enum (
    'new', 'attempted', 'contacted', 'discovery_done', 'feed_agreed', 'live', 'dead'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- allowed_emails — the entire authz model. 5-person internal tool.
-- ---------------------------------------------------------------------------
create table if not exists allowed_emails (
  email text primary key
);

insert into allowed_emails (email) values
  ('michael@modularequity.com'),
  ('rep1@example.com'),
  ('rep2@example.com'),
  ('rep3@example.com'),
  ('rep4@example.com')
on conflict (email) do nothing;

-- ---------------------------------------------------------------------------
-- yards
-- ---------------------------------------------------------------------------
create table if not exists yards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  dba text,
  address text,
  city text,
  state text default 'GA',
  zip text,
  county text,
  lat double precision,
  lng double precision,
  phone text,
  phone_alt text,
  email text,
  website text,
  source text not null,
  source_url text,
  osm_id text,
  google_place_id text,
  rating numeric,
  review_count int,
  yard_type text,
  published_listing_count int,
  publishes_online boolean,
  ims_vendor text,
  stage yard_stage not null default 'new',
  owner_user_id uuid,
  dedupe_key text unique,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists yards_stage_idx on yards (stage);
create index if not exists yards_listing_count_idx on yards (published_listing_count desc nulls last);
create index if not exists yards_geo_idx on yards (lat, lng);

-- ---------------------------------------------------------------------------
-- contacts
-- ---------------------------------------------------------------------------
create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  yard_id uuid not null references yards (id) on delete cascade,
  name text,
  title text,
  phone text,
  email text,
  is_primary boolean default false,
  notes text,
  created_at timestamptz default now()
);

create index if not exists contacts_yard_idx on contacts (yard_id);

-- ---------------------------------------------------------------------------
-- activities — every touch. type/disposition constrained to the brief's vocabulary.
-- ---------------------------------------------------------------------------
create table if not exists activities (
  id uuid primary key default gen_random_uuid(),
  yard_id uuid not null references yards (id) on delete cascade,
  contact_id uuid references contacts (id) on delete set null,
  user_email text,
  type text check (type in ('call', 'voicemail', 'email', 'visit', 'note')),
  disposition text check (disposition in (
    'connected', 'no_answer', 'gatekeeper', 'callback', 'not_interested', 'qualified', 'dead'
  )),
  notes text,
  occurred_at timestamptz default now(),
  next_action text,
  next_action_due date
);

create index if not exists activities_yard_idx on activities (yard_id, occurred_at desc);
create index if not exists activities_due_idx on activities (next_action_due);

-- ---------------------------------------------------------------------------
-- intakes — ONE ROW PER COMPLETED DISCOVERY. THIS IS THE CENSUS.
-- Field names and answer vocabularies are the measurement instrument; do not
-- reword them without invalidating comparability across calls.
-- ---------------------------------------------------------------------------
create table if not exists intakes (
  id uuid primary key default gen_random_uuid(),
  yard_id uuid not null unique references yards (id) on delete cascade,
  completed_by text,
  completed_at timestamptz,

  -- Roughly how many parts do you have on the yard right now?
  inventory_size text,              -- <500 | 500-2k | 2k-10k | 10k+ | unknown
  -- What do you use to track inventory?
  ims_vendor text,                  -- ITrack | Checkmate/Car-Part | Hollander Powerlink | Pinnacle | Spreadsheet | Paper | Other | Unknown
  -- Where do you list inventory online today?
  publishes_where text[],           -- HeavyTruckParts.net | TruckPartsInventory | Own website | eBay | Facebook | None
  -- How often do those listings get updated?
  update_frequency text,            -- real-time | daily | weekly | rarely | never
  -- Out of 10 calls you take, how many are just "do you have X, what's it cost"?
  pct_availability_calls int check (pct_availability_calls between 0 and 10),
  -- Top 3 moving component families
  top_families text[],
  -- Who buys from you most?
  buyer_mix text,                   -- fleets direct | independent repair shops | other yards/brokers | retail/walk-in | mixed
  -- If a live inventory feed drove more inbound calls at no cost to you, would you push us one?
  feed_willingness text,            -- yes | maybe | no
  -- If maybe/no — what's the hesitation? (free text; this is the product roadmap)
  feed_objection text,
  -- Any contract or exclusivity stopping you from listing elsewhere?
  exclusivity_constraint boolean,
  -- Rep's own 1-5 read on whether this yard actually converts to a feed
  rep_confidence int check (rep_confidence between 1 and 5),

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists intakes_yard_idx on intakes (yard_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists yards_updated_at on yards;
create trigger yards_updated_at before update on yards
  for each row execute function set_updated_at();

drop trigger if exists intakes_updated_at on intakes;
create trigger intakes_updated_at before update on intakes
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: any authenticated user whose email is in allowed_emails can read and
-- write everything. Deliberately NOT per-user row isolation — 5-person team,
-- and reps must see each other's yards to avoid double-calling.
-- ---------------------------------------------------------------------------
create or replace function is_allowed_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from allowed_emails
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

alter table yards           enable row level security;
alter table contacts        enable row level security;
alter table activities      enable row level security;
alter table intakes         enable row level security;
alter table allowed_emails  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['yards', 'contacts', 'activities', 'intakes'] loop
    execute format('drop policy if exists %I on %I', t || '_allowed_all', t);
    execute format(
      'create policy %I on %I for all to authenticated using (is_allowed_user()) with check (is_allowed_user())',
      t || '_allowed_all', t
    );
  end loop;
end $$;

-- Reps may read the roster (so the app can show who has access) but not edit it.
drop policy if exists allowed_emails_read on allowed_emails;
create policy allowed_emails_read on allowed_emails
  for select to authenticated using (is_allowed_user());
