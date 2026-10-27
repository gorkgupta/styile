import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cookieDomain, RESERVED_SLUGS, routeRequest, salonAddress, salonSlugFromHost, salonUrl, mainUrl } from '../src/lib/tenant';

const ROOT = 'styile.com';

test('salon is read from the subdomain only', () => {
  assert.equal(salonSlugFromHost('glowstudio.styile.com', ROOT), 'glowstudio');
  assert.equal(salonSlugFromHost('GlowStudio.Styile.com', ROOT), 'glowstudio');
  assert.equal(salonSlugFromHost('styile.com', ROOT), null);
  assert.equal(salonSlugFromHost('www.styile.com', ROOT), null, 'reserved');
  assert.equal(salonSlugFromHost('admin.styile.com', ROOT), null, 'reserved');
  assert.equal(salonSlugFromHost('a.b.styile.com', ROOT), null, 'no nested subdomains');
  assert.equal(salonSlugFromHost('glowstudio.styile.com.evil.in', ROOT), null);
  assert.equal(salonSlugFromHost('evilstyile.com', ROOT), null);
  assert.equal(salonSlugFromHost('glowstudio.localhost:3000', 'localhost:3000'), 'glowstudio');
  assert.equal(salonSlugFromHost('glowstudio.styile.com', ''), null, 'subdomains off');
});

test('links to a salon site', () => {
  assert.equal(salonUrl('glowstudio', '/me', ROOT), 'https://glowstudio.styile.com/me');
  assert.equal(salonUrl('glowstudio', '', 'localhost:3000'), 'http://glowstudio.localhost:3000');
  assert.equal(salonAddress('glowstudio', ROOT), 'glowstudio.styile.com');
  assert.equal(mainUrl('/signup', ROOT), 'https://styile.com/signup');
  assert.equal(cookieDomain(ROOT), '.styile.com', 'one login across all salon sites');
  assert.equal(cookieDomain('localhost:3000'), undefined);
});

test('routing on a salon address', () => {
  const r = (path: string, search = '') => routeRequest('glowstudio.styile.com', path, search, ROOT);
  assert.deepEqual(r('/'), { kind: 'rewrite', pathname: '/s/glowstudio', salon: 'glowstudio' });
  assert.deepEqual(r('/me'), { kind: 'rewrite', pathname: '/s/glowstudio/me', salon: 'glowstudio' });
  assert.deepEqual(r('/me/bills/abc'), { kind: 'rewrite', pathname: '/s/glowstudio/me/bills/abc', salon: 'glowstudio' });
  assert.equal(r('/app/calendar').kind, 'next');
  assert.equal(r('/login').kind, 'next');
  assert.equal(r('/api/whatsapp/webhook').kind, 'next');
  assert.deepEqual(r('/signup'), { kind: 'redirect', url: 'https://styile.com/signup', salon: 'glowstudio' });
  assert.deepEqual(r('/admin', '?x=1'), { kind: 'redirect', url: 'https://styile.com/admin?x=1', salon: 'glowstudio' });
  assert.deepEqual(r('/s/glowstudio/me'), { kind: 'redirect', url: '/me', salon: 'glowstudio' });
  assert.deepEqual(r('/s/other'), { kind: 'redirect', url: 'https://other.styile.com/', salon: 'glowstudio' }, 'cannot show another salon under this address');
});

test('routing on the main site', () => {
  const r = (path: string) => routeRequest('styile.com', path, '', ROOT);
  assert.equal(r('/').kind, 'next');
  assert.equal(r('/admin').kind, 'next');
  assert.deepEqual(r('/s/glowstudio'), { kind: 'redirect', url: 'https://glowstudio.styile.com', salon: null }, 'old links move to the salon address');
  assert.deepEqual(r('/s/glowstudio/me/bills/x'), { kind: 'redirect', url: 'https://glowstudio.styile.com/me/bills/x', salon: null });
  // Without a root domain (local dev / preview deploys) the /s/<slug> pages are served directly.
  assert.equal(routeRequest('kesh.workers.dev', '/s/glowstudio', '', '').kind, 'next');
});

test('reserved addresses match the database', () => {
  const sql = readFileSync(new URL('../supabase/migrations/0004_salon_addresses.sql', import.meta.url), 'utf8');
  for (const w of RESERVED_SLUGS) assert.ok(sql.includes(`'${w}'`), `${w} reserved in SQL`);
});
