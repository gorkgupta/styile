// Builds a static, clickable preview of the app screens with sample data — no Supabase or Next.js server needed.
// Usage: node preview/build.mjs   -> preview/dist/index.html
import * as esbuild from '/opt/npm-tools/node_modules/esbuild/lib/main.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const src = path.join(root, 'src');
const nm = process.env.PREVIEW_NODE_MODULES || '/opt/npm-tools/node_modules';

function resolveFile(base) {
  for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
    const p = base + ext;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}

const previewPlugin = {
  name: 'preview',
  setup(build) {
    build.onResolve({ filter: /^server-only$/ }, () => ({ path: 'server-only', namespace: 'empty' }));
    build.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: '', loader: 'js' }));
    build.onResolve({ filter: /^next\/link$/ }, () => ({ path: path.join(here, 'shims/link.tsx') }));
    build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: path.join(here, 'shims/navigation.ts') }));
    build.onResolve({ filter: /^@\/lib\/supabase\/client$/ }, () => ({ path: path.join(here, 'shims/supabase-client.ts') }));
    // Server actions -> mock implementations with the same export names.
    build.onResolve({ filter: /^@\/actions\// }, (args) => ({ path: resolveFile(path.join(src, args.path.slice(2))), namespace: 'mock-actions' }));
    build.onLoad({ filter: /.*/, namespace: 'mock-actions' }, (args) => {
      const text = fs.readFileSync(args.path, 'utf8');
      const names = [...text.matchAll(/export\s+async\s+function\s+(\w+)/g)].map((m) => m[1]);
      const lines = [`import { mockAction } from ${JSON.stringify(path.join(here, 'mock-actions.ts'))};`];
      for (const n of names) lines.push(`export const ${n} = (...args) => mockAction(${JSON.stringify(n)}, ...args);`);
      return { contents: lines.join('\n'), loader: 'js', resolveDir: here };
    });
    build.onResolve({ filter: /^@\// }, (args) => {
      const p = resolveFile(path.join(src, args.path.slice(2)));
      if (!p) return { errors: [{ text: `Cannot resolve ${args.path}` }] };
      return { path: p };
    });
  },
};

fs.mkdirSync(path.join(here, 'dist'), { recursive: true });
const result = await esbuild.build({
  entryPoints: [path.join(here, 'main.tsx')],
  bundle: true,
  outfile: path.join(here, 'dist/app.js'),
  format: 'iife',
  jsx: 'automatic',
  target: 'es2022',
  nodePaths: [nm],
  define: { 'process.env.NODE_ENV': process.env.PREVIEW_DEV ? '"development"' : '"production"', 'process.env.NEXT_PUBLIC_SUPABASE_URL': '""', 'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': '""', 'process.env.NEXT_PUBLIC_ROOT_DOMAIN': '"styile.com"', 'process.env.NEXT_PUBLIC_APP_URL': '"https://styile.com"', 'process.env.NEXT_PUBLIC_SUPPORT_EMAIL': '"support@styile.com"' },
  plugins: [previewPlugin],
  logLevel: 'warning',
  metafile: false,
  minify: !process.env.PREVIEW_DEV,
});
if (result.errors.length) process.exit(1);
fs.writeFileSync(path.join(here, 'dist/globals.css'), fs.readFileSync(path.join(src, 'app/globals.css'), 'utf8') + `\n/* demo only */\n.demo-pill { position: fixed; z-index: 70; right: calc(16px + env(safe-area-inset-right, 0px)); bottom: calc(16px + env(safe-area-inset-bottom, 0px)); background: var(--ink); color: #fff; padding: 8px 14px; border-radius: 999px; font-size: 13px; font-weight: 600; box-shadow: var(--shadow-pop); text-decoration: none; }\n.demo-pill:hover { text-decoration: none; background: var(--peacock); }\n@media (max-width: 860px) { .demo-pill { bottom: calc(84px + env(safe-area-inset-bottom, 0px)); } }\n`);
fs.writeFileSync(path.join(here, 'dist/index.html'), `<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Styile preview</title><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700;800&family=Noto+Sans+Devanagari:wght@400;500;600;700&family=Noto+Sans+Bengali:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="globals.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>`);
console.log('preview built -> preview/dist/index.html');
