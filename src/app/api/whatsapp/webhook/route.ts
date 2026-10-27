import { after, NextResponse, type NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { verifyMetaSignature } from '@/lib/whatsapp/signature';
import { handleWebhookPayload, type WaWebhookPayload } from '@/lib/whatsapp/bot';

// Meta calls this URL for every WhatsApp message and delivery status, for every salon number
// connected to the Styile app. Configure it in Meta for Developers > WhatsApp > Configuration.

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if (p.get('hub.mode') === 'subscribe' && p.get('hub.verify_token') === env.waVerifyToken()) {
    return new NextResponse(p.get('hub.challenge') ?? '', { status: 200 });
  }
  return new NextResponse('Forbidden', { status: 403 });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!(await verifyMetaSignature(raw, req.headers.get('x-hub-signature-256'), env.waAppSecret()))) {
    return new NextResponse('Invalid signature', { status: 401 });
  }
  let payload: WaWebhookPayload;
  try { payload = JSON.parse(raw); } catch { return new NextResponse('Bad JSON', { status: 400 }); }
  // Acknowledge immediately (Meta retries slow webhooks); the assistant replies in the background.
  after(() => handleWebhookPayload(payload));
  return NextResponse.json({ received: true });
}
