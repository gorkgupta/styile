import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { verifyStandardWebhook } from '@/lib/whatsapp/signature';
import { sendLoginCode } from '@/lib/whatsapp/outbox';

// Supabase "Send SMS" auth hook: instead of an SMS, the customer's login code arrives on WhatsApp
// from the platform number (authentication template). No DLT registration needed.

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!(await verifyStandardWebhook(raw, req.headers, env.smsHookSecret()))) {
    return NextResponse.json({ error: { http_code: 401, message: 'Invalid signature' } }, { status: 401 });
  }
  try {
    const body = JSON.parse(raw) as { user?: { phone?: string }; sms?: { otp?: string } };
    const phone = (body.user?.phone ?? '').replace(/\D/g, '');
    const otp = body.sms?.otp ?? '';
    if (!phone || !otp) return NextResponse.json({ error: { http_code: 400, message: 'Missing phone or code' } }, { status: 400 });
    await sendLoginCode(phone, otp);
    return NextResponse.json({});
  } catch (e) {
    console.error('Login code send failed', e);
    return NextResponse.json({ error: { http_code: 500, message: 'Could not send the code on WhatsApp. Please try again.' } }, { status: 500 });
  }
}
