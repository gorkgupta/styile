// Screenshots preview routes. Usage: node preview/shot.mjs /app /app/calendar [--mobile] [--full] [--wait=ms]
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const mobile = args.includes('--mobile');
const full = args.includes('--full');
const wait = Number(args.find((a) => a.startsWith('--wait='))?.slice(7)) || 400; // longer for screens a preview script clicks through
const routes = args.filter((a) => !a.startsWith('--'));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, deviceScaleFactor: mobile ? 2 : 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
for (const r of routes) {
  await page.goto('file://' + path.join(here, 'dist/index.html') + '#' + r);
  await page.waitForTimeout(wait);
  const file = path.join(here, 'shots', (r.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'index') + (mobile ? '.mobile' : '') + '.png');
  await page.screenshot({ path: file, fullPage: full });
  console.log(file);
}
if (errors.length) console.log('ERRORS:\n' + [...new Set(errors)].filter((e) => !e.includes('fonts.googleapis')).join('\n'));
await browser.close();
