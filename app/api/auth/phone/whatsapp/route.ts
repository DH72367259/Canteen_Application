import { NextRequest, NextResponse } from 'next/server'

const ACCOUNT_SID  = process.env.TWILIO_ACCOUNT_SID
const AUTH_TOKEN   = process.env.TWILIO_AUTH_TOKEN
const VERIFY_SID   = process.env.TWILIO_VERIFY_SID
const WA_ENABLED   = process.env.TWILIO_WHATSAPP_ENABLED === 'true'

// Send a Twilio Verify verification via a specific channel
async function sendVerification(to: string, channel: 'sms' | 'whatsapp'): Promise<string | null> {
  if (!ACCOUNT_SID || !AUTH_TOKEN || !VERIFY_SID) return 'Twilio not configured'
  const creds = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')
  const res = await fetch(
    `https://verify.twilio.com/v2/Services/${VERIFY_SID}/Verifications`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${creds}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, Channel: channel }).toString(),
    }
  )
  if (!res.ok) {
    const body = await res.text()
    return `Twilio ${channel} error: ${res.status} ${body.substring(0, 100)}`
  }
  return null // null = success
}

export async function POST(req: NextRequest) {
  let phone: string
  try {
    const body = await req.json()
    phone = body.phone
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  // Validate phone: must start with + and contain only digits after that
  if (!phone || !/^\+\d{8,15}$/.test(phone)) {
    return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 })
  }

  // WhatsApp delivery is only attempted when explicitly enabled and Business setup is complete
  if (!WA_ENABLED) {
    // WhatsApp not yet configured — caller should fall back to SMS via Supabase
    return NextResponse.json({ whatsapp: false, reason: 'WhatsApp not enabled' })
  }

  const err = await sendVerification(phone, 'whatsapp')
  if (err) {
    // WhatsApp failed — return non-error so caller falls back to SMS
    return NextResponse.json({ whatsapp: false, reason: err })
  }

  return NextResponse.json({ whatsapp: true })
}
