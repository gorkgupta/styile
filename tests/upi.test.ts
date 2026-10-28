// UPI QR: the payload the client's app reads, and the QR encoder's known sizes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidVpa, upiPayUrl } from '../src/lib/upi';
import { qrMatrix, qrSvgPath } from '../src/lib/qr';

test('UPI payload: payee, amount with two decimals, INR, URL-encoded name and note', () => {
  assert.equal(
    upiPayUrl({ vpa: 'dooarssalon@oksbi', name: 'Dooars Unisex Salon', amount: 1049, note: 'Bill DUS-01407' }),
    'upi://pay?pa=dooarssalon@oksbi&pn=Dooars%20Unisex%20Salon&am=1049.00&cu=INR&tn=Bill%20DUS-01407',
  );
  assert.equal(upiPayUrl({ vpa: 'a.b@ybl', name: 'Tashi & Sons', amount: 99.5 }), 'upi://pay?pa=a.b@ybl&pn=Tashi%20%26%20Sons&am=99.50&cu=INR');
  // No amount (payer types it), and characters that would break the query are encoded.
  assert.equal(upiPayUrl({ vpa: 'x@paytm', name: 'Glow=Studio?', amount: 0, note: 'a&am=1' }), 'upi://pay?pa=x@paytm&pn=Glow%3DStudio%3F&cu=INR&tn=a%26am%3D1');
  assert.equal(upiPayUrl({ vpa: 'x@paytm', name: 'Ā', amount: 10.005 }), 'upi://pay?pa=x@paytm&pn=%C4%80&am=10.01&cu=INR');
});

test('UPI ID format', () => {
  for (const ok of ['glowstudio@okicici', '9876543210@ybl', 'salon.jaigaon@sbi', 'tashi_parlour-1@axl']) assert.ok(isValidVpa(ok), ok);
  for (const bad of ['9876543210', 'tashi parlour@sbi', '@sbi', 'x@sbi&am=1', 'x@1bank', '', null]) assert.ok(!isValidVpa(bad), String(bad));
});

test('QR encoder: version and size grow with the payload (ECC M, byte mode)', () => {
  const v1 = qrMatrix('HELLO');
  assert.equal(v1.version, 1);
  assert.equal(v1.size, 21);
  // 14 bytes is the byte-mode capacity of version 1-M; 15 needs version 2 (25×25).
  assert.equal(qrMatrix('a'.repeat(14)).version, 1);
  assert.equal(qrMatrix('a'.repeat(15)).version, 2);
  assert.equal(qrMatrix('a'.repeat(15)).size, 25);
  const url = upiPayUrl({ vpa: 'dooarssalon@oksbi', name: 'Dooars Unisex Salon', amount: 1049, note: 'Bill DUS-01407' });
  const m = qrMatrix(url);
  assert.ok(m.version >= 5 && m.version <= 6, `UPI payload fits a small code (got v${m.version})`);
  assert.equal(m.size, 17 + 4 * m.version);
  assert.ok(m.mask >= 0 && m.mask <= 7);
  // Finder patterns: dark corners, light separator.
  assert.ok(m.dark(0, 0) && m.dark(6, 6) && !m.dark(7, 7) && m.dark(m.size - 1, 0) && m.dark(0, m.size - 1));
  const svg = qrSvgPath(url);
  assert.equal(svg.size, m.size + 8);
  assert.match(svg.path, /^M4,4h7v1h-7z/);
});
