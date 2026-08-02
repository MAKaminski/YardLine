'use client'

import { useCallback, useEffect, useState } from 'react'
import { use } from 'react'
import Link from 'next/link'
import AuthGate from '@/components/AuthGate'
import { createClient } from '@/lib/supabase/client'
import {
  DISPOSITIONS,
  STAGES,
  STAGE_COLOR,
  STAGE_LABEL,
  type Activity,
  type Contact,
  type Stage,
  type Yard,
} from '@/lib/types'

function YardDetail({ id }: { id: string }) {
  const [yard, setYard] = useState<Yard | null>(null)
  const [acts, setActs] = useState<Activity[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [hasIntake, setHasIntake] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [cName, setCName] = useState('')
  const [cTitle, setCTitle] = useState('')
  const [cPhone, setCPhone] = useState('')
  const [yardEmail, setYardEmail] = useState('')
  const [inviteState, setInviteState] = useState<string | null>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data: sess } = await supabase.auth.getSession()
    setEmail(sess.session?.user.email ?? null)

    const [{ data: y }, { data: a }, { data: c }, { data: i }] = await Promise.all([
      supabase.from('yards').select('*').eq('id', id).single(),
      supabase.from('activities').select('*').eq('yard_id', id).order('occurred_at', { ascending: false }),
      supabase.from('contacts').select('*').eq('yard_id', id).order('is_primary', { ascending: false }),
      supabase.from('intakes').select('yard_id, completed_at').eq('yard_id', id).maybeSingle(),
    ])
    setYard((y as Yard) ?? null)
    setYardEmail(((y as Yard) ?? null)?.email ?? '')
    setActs((a ?? []) as Activity[])
    setContacts((c ?? []) as Contact[])
    setHasIntake(Boolean(i && (i as { completed_at: string | null }).completed_at))
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  /** One tap: writes the activity AND advances the stage. No modal. */
  async function logDisposition(d: (typeof DISPOSITIONS)[number]) {
    if (!yard) return
    // Killing a yard is the one irreversible tap on this screen, and with a
    // short call list one fat thumb costs a real prospect.
    if (d.advancesTo === 'dead' && !confirm(`Mark ${yard.name} dead? This removes it from your call list.`)) {
      return
    }
    setSaving(d.key)
    setErr(null)
    const supabase = createClient()

    const isVoicemail = d.key === 'voicemail'
    const { error: aErr } = await supabase.from('activities').insert({
      yard_id: yard.id,
      user_email: email,
      type: isVoicemail ? 'voicemail' : 'call',
      disposition: isVoicemail ? 'no_answer' : d.key,
      notes: note.trim() || null,
      // Due TODAY. "Call me back after ten" is a same-morning callback; dating
      // it tomorrow hid the hottest lead of the day from the Today view.
      ...(d.key === 'callback'
        ? { next_action: 'Callback', next_action_due: new Date().toISOString().slice(0, 10) }
        : {}),
    })

    if (aErr) {
      setErr(aErr.message)
      setSaving(null)
      return
    }

    // Never move a yard backwards along the pipeline.
    if (d.advancesTo) {
      const cur = STAGES.indexOf(yard.stage)
      const next = STAGES.indexOf(d.advancesTo)
      const shouldAdvance = d.advancesTo === 'dead' || next > cur
      if (shouldAdvance) {
        await supabase.from('yards').update({ stage: d.advancesTo }).eq('id', yard.id)
      }
    }

    setNote('')
    setSaving(null)
    load()
  }

  async function setStage(stage: Stage) {
    if (!yard) return
    const supabase = createClient()
    await supabase.from('yards').update({ stage }).eq('id', yard.id)
    load()
  }

  if (!yard) return <p className="p-4 text-sm text-slate-400">Loading…</p>

  const tel = yard.phone?.replace(/[^\d+]/g, '')
  const mapQ = encodeURIComponent(
    [yard.address, yard.city, yard.state, yard.zip].filter(Boolean).join(', ') || yard.name
  )

  return (
    <main className="px-4 py-4">
      <div className="flex items-center gap-2">
        <span
          className="h-3 w-3 rounded-full"
          style={{ background: STAGE_COLOR[yard.stage] ?? '#64748b' }}
        />
        <h1 className="text-xl font-black leading-tight">{yard.name}</h1>
      </div>
      <p className="mt-1 text-sm text-slate-400">
        {[yard.address, yard.city, yard.state, yard.zip].filter(Boolean).join(', ') ||
          'Address unknown'}
      </p>

      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        <span className="rounded bg-slate-800 px-2 py-0.5">{STAGE_LABEL[yard.stage]}</span>
        {yard.yard_type && (
          <span className="rounded bg-slate-800 px-2 py-0.5 text-slate-300">{yard.yard_type}</span>
        )}
        {yard.published_listing_count != null && (
          <span className="rounded bg-indigo-950 px-2 py-0.5 text-indigo-300">
            {yard.published_listing_count.toLocaleString()} listed online
          </span>
        )}
        <span className="rounded bg-slate-800 px-2 py-0.5 text-slate-400">src: {yard.source}</span>
      </div>

      {/* Primary actions */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        {tel ? (
          <a
            href={`tel:${tel}`}
            className="rounded-xl bg-emerald-600 px-4 py-4 text-center text-base font-bold active:bg-emerald-700"
          >
            Call {yard.phone}
          </a>
        ) : (
          <span className="rounded-xl bg-slate-800 px-4 py-4 text-center text-sm text-slate-500">
            No phone on file
          </span>
        )}
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${mapQ}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-4 text-center text-base font-semibold"
        >
          Directions
        </a>
      </div>

      <Link
        href={`/yards/${yard.id}/intake`}
        className={`mt-2 block rounded-xl px-4 py-4 text-center text-base font-bold ${
          hasIntake ? 'border border-slate-700 bg-slate-900 text-slate-300' : 'bg-violet-600'
        }`}
      >
        {hasIntake ? 'Discovery complete — review' : 'Start discovery (4 min)'}
      </Link>

      {/* Send the census instead of calling it. Uses Resend, NOT Supabase auth
          email — that path is capped at 2/hour and is needed for rep logins. */}
      <section className="mt-4 rounded-xl border border-slate-800 bg-slate-900 p-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400">
          Or send it — no call needed
        </h2>
        <div className="mt-2 flex gap-2">
          <input
            type="email"
            inputMode="email"
            value={yardEmail}
            onChange={(e) => setYardEmail(e.target.value)}
            onBlur={async () => {
              const v = yardEmail.trim() || null
              if (v === (yard.email ?? null)) return
              const supabase = createClient()
              await supabase.from('yards').update({ email: v }).eq('id', yard.id)
              load()
            }}
            placeholder="yard@example.com"
            className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-base outline-none focus:border-blue-500"
          />
          <button
            onClick={async () => {
              setInviteState('sending')
              const supabase = createClient()
              const to = yardEmail.trim()
              if (!to) {
                setInviteState('Enter an email address first.')
                return
              }
              try {
                const res = await fetch('/api/invite', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ token: yard.public_token, email: to, yardName: yard.name }),
                })
                const j = await res.json()
                await supabase.from('intake_invites').insert({
                  yard_id: yard.id,
                  token: yard.public_token,
                  sent_to: to,
                  sent_by: email,
                })
                if (j.sent) setInviteState(`Sent to ${to}`)
                else if (j.mailto) {
                  window.location.href = j.mailto
                  setInviteState('Opened your mail app')
                } else setInviteState(j.error ?? 'Send failed')
              } catch {
                setInviteState('Send failed')
              }
              load()
            }}
            className="shrink-0 rounded-lg bg-violet-600 px-4 py-3 text-sm font-bold"
          >
            {inviteState === 'sending' ? '…' : 'Email intake'}
          </button>
        </div>
        {inviteState && inviteState !== 'sending' && (
          <p className="mt-2 text-xs text-slate-400">{inviteState}</p>
        )}
        {yard.public_token && (
          <p className="mt-2 break-all text-xs text-slate-600">
            Share link: /i/{yard.public_token}
          </p>
        )}
      </section>

      {/* One-tap dispositions */}
      <section className="mt-6">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-400">
          Log the call — one tap
        </h2>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Who you spoke to, what they said, when to call back…"
          className="mb-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-3 text-base outline-none focus:border-blue-500"
        />
        <div className="grid grid-cols-2 gap-2">
          {DISPOSITIONS.map((d) => (
            <button
              key={d.key}
              onClick={() => logDisposition(d)}
              disabled={saving !== null}
              className={`${d.tone} rounded-xl px-3 py-4 text-sm font-bold disabled:opacity-50`}
            >
              {saving === d.key ? 'Saving…' : d.label}
            </button>
          ))}
        </div>
        {err && <p className="mt-2 text-sm text-red-400">{err}</p>}
      </section>

      {/* Stage override */}
      <section className="mt-6">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-400">Stage</h2>
        <div className="flex flex-wrap gap-2">
          {STAGES.map((s) => (
            <button
              key={s}
              onClick={() => setStage(s)}
              className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                yard.stage === s ? 'text-white' : 'bg-slate-800 text-slate-300'
              }`}
              style={yard.stage === s ? { background: STAGE_COLOR[s] } : undefined}
            >
              {STAGE_LABEL[s]}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-400">
          Contacts ({contacts.length})
        </h2>

        {/* The name and direct line you get on the call are the whole point of
            the call. Without this there is nowhere to put them. */}
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            if (!cName.trim() && !cPhone.trim()) return
            const supabase = createClient()
            await supabase.from('contacts').insert({
              yard_id: id,
              name: cName.trim() || null,
              title: cTitle.trim() || null,
              phone: cPhone.trim() || null,
              is_primary: contacts.length === 0,
            })
            setCName('')
            setCTitle('')
            setCPhone('')
            load()
          }}
          className="mb-2 grid grid-cols-3 gap-2"
        >
          <input
            value={cName}
            onChange={(e) => setCName(e.target.value)}
            placeholder="Name"
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-3 text-base outline-none focus:border-blue-500"
          />
          <input
            value={cTitle}
            onChange={(e) => setCTitle(e.target.value)}
            placeholder="Title"
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-3 text-base outline-none focus:border-blue-500"
          />
          <input
            value={cPhone}
            onChange={(e) => setCPhone(e.target.value)}
            inputMode="tel"
            placeholder="Direct line"
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-3 text-base outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            className="col-span-3 rounded-lg bg-slate-700 px-3 py-3 text-sm font-bold"
          >
            Save contact
          </button>
        </form>

        {contacts.length > 0 && (
          <ul className="space-y-2">
            {contacts.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900 p-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold">{c.name || 'Unnamed'}</p>
                  <p className="truncate text-xs text-slate-400">{c.title}</p>
                </div>
                {c.phone && (
                  <a
                    href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold"
                  >
                    Call
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-400">
          Activity ({acts.length})
        </h2>
        {acts.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing logged yet.</p>
        ) : (
          <ul className="space-y-2">
            {acts.map((a) => (
              <li key={a.id} className="rounded-lg border border-slate-800 bg-slate-900 p-3 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="font-semibold capitalize">
                    {a.type} · {a.disposition?.replace(/_/g, ' ')}
                  </span>
                  <span className="shrink-0 text-xs text-slate-500">
                    {new Date(a.occurred_at).toLocaleString()}
                  </span>
                </div>
                {a.notes && <p className="mt-1 text-slate-300">{a.notes}</p>}
                {a.next_action_due && (
                  <p className="mt-1 text-xs text-amber-400">
                    {a.next_action} due {a.next_action_due}
                  </p>
                )}
                {a.user_email && <p className="mt-1 text-xs text-slate-600">{a.user_email}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {yard.source_url && (
        <p className="mt-6 break-all text-xs text-slate-600">Source: {yard.source_url}</p>
      )}
    </main>
  )
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return (
    <AuthGate>
      <YardDetail id={id} />
    </AuthGate>
  )
}
