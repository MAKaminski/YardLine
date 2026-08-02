import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'

/**
 * Emails a yard its tokenized census link.
 *
 * This endpoint sends mail, so it is NOT open: it verifies the caller has a
 * Supabase session AND is on the allowed_emails roster before sending. Without
 * that check it would be an open relay.
 *
 * Sending uses the Resend API, which is deliberately independent of Supabase
 * auth's SMTP — that path is capped at 2 emails/hour and is currently the
 * bottleneck on rep logins. Invites must not compete with it.
 *
 * If RESEND_API_KEY is unset the route returns a prefilled mailto: URL so the
 * rep can send from their own client. The feature is never blocked on config.
 */
/**
 * Reports only whether email sending is configured — never the key itself.
 * The rep UI uses this to say "will send" vs "will open your mail app", and it
 * is how we verify a Vercel env change actually reached the running deployment.
 */
export async function GET() {
  return NextResponse.json({ configured: Boolean(process.env.RESEND_API_KEY) })
}

export async function POST(request: Request) {
  let body: { token?: string; email?: string; yardName?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }

  const { token, email, yardName } = body
  if (!token || !email) {
    return NextResponse.json({ error: 'token and email are required' }, { status: 400 })
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'invalid email address' }, { status: 400 })
  }

  // --- authorization: a real, rostered rep only -----------------------------
  const supabase = await createServerSupabase()
  const { data: sessionData } = await supabase.auth.getUser()
  const caller = sessionData.user?.email
  if (!caller) {
    return NextResponse.json({ error: 'not signed in' }, { status: 401 })
  }
  const { data: allowed } = await supabase
    .from('allowed_emails')
    .select('email')
    .ilike('email', caller)
    .maybeSingle()
  if (!allowed) {
    return NextResponse.json({ error: 'not authorized' }, { status: 403 })
  }

  const origin = new URL(request.url).origin
  const link = `${origin}/i/${token}`
  const subject = 'What are your used truck parts actually worth?'
  const text = [
    `Hi${yardName ? ` — ${yardName}` : ''},`,
    '',
    'We are mapping how heavy-duty truck parts inventory actually moves in Georgia.',
    '',
    'This link shows you what parts like yours are currently listed for, and asks',
    'eleven short questions about how you track and sell inventory. About four',
    'minutes, no account, no salesperson.',
    '',
    link,
    '',
    'If a live listing feed would send you more inbound calls at no cost, your',
    'answers are what decide whether we build it.',
    '',
    '— YardLine',
  ].join('\n')

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    // No secret configured — hand the rep a mailto: they can send themselves.
    return NextResponse.json({
      sent: false,
      fallback: 'mailto',
      mailto: `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(
        subject
      )}&body=${encodeURIComponent(text)}`,
      link,
    })
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'YardLine <yardline@modularequity.com>',
      to: [email],
      subject,
      text,
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return NextResponse.json(
      { error: 'send failed', status: res.status, detail: detail.slice(0, 300), link },
      { status: 502 }
    )
  }

  const sent = (await res.json()) as { id?: string }
  return NextResponse.json({ sent: true, id: sent.id, link })
}
