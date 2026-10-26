import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyMetaSignature, verifyStandardWebhook } from '../src/lib/whatsapp/signature';
import { toGraphPayload } from '../src/lib/whatsapp/cloud-api-payload';

test('Meta webhook signature', async () => {
  const body = '{"object":"whatsapp_business_account"}';
  const sig = 'sha256=' + createHmac('sha256', 'app-secret').update(body).digest('hex');
  assert.equal(await verifyMetaSignature(body, sig, 'app-secret'), true);
  assert.equal(await verifyMetaSignature(body + ' ', sig, 'app-secret'), false);
  assert.equal(await verifyMetaSignature(body, sig, 'other'), false);
  assert.equal(await verifyMetaSignature(body, null, 'app-secret'), false);
});

test('Supabase (Standard Webhooks) hook signature', async () => {
  const key = Buffer.from('supersecretkey-1234567890');
  const secret = 'v1,whsec_' + key.toString('base64');
  const body = '{"user":{"phone":"919876543210"},"sms":{"otp":"123456"}}';
  const id = 'msg_1', ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
  const h = (s: string, t = ts) => new Headers({ 'webhook-id': id, 'webhook-timestamp': t, 'webhook-signature': s });
  assert.equal(await verifyStandardWebhook(body, h(`v1,${sig}`), secret), true);
  assert.equal(await verifyStandardWebhook(body, h(`v1,bad v1,${sig}`), secret), true, 'any listed signature may match');
  assert.equal(await verifyStandardWebhook(body, h('v1,bad'), secret), false);
  assert.equal(await verifyStandardWebhook(body, h(`v1,${sig}`, String(Number(ts) - 3600)), secret), false, 'stale timestamp');
});

test('WhatsApp payloads respect API limits', () => {
  const p = toGraphPayload('919876543210', { type: 'buttons', text: 'Confirm?', buttons: [{ id: 'confirm', title: 'Confirm booking now please' }, { id: 'a', title: 'b' }, { id: 'c', title: 'd' }, { id: 'e', title: 'f' }] }) as any;
  assert.equal(p.interactive.action.buttons.length, 3);
  assert.ok(p.interactive.action.buttons[0].reply.title.length <= 20);
  const t = toGraphPayload('919876543210', { type: 'template', name: 'login_code', otpCode: '123456' }) as any;
  assert.equal(t.template.components[0].parameters[0].text, '123456');
  assert.equal(t.template.components[1].sub_type, 'url');
});
