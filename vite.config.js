import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';

// Writes dist/sw.js with a precache list of every built file and a content
// hash as the cache version. No Workbox needed.
function serviceWorker() {
  let outDir;
  const walk = (dir) =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  return {
    name: 'gully-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const files = walk(outDir)
        .filter((f) => !/(^|[\\/])(sw\.js|index\.html)$/.test(f) && !f.endsWith('.map'))
        .sort();
      const hash = createHash('sha256');
      for (const f of files) hash.update(f).update(readFileSync(f));
      hash.update(readFileSync(join(outDir, 'index.html')));
      const urls = ['./', ...files.map((f) => relative(outDir, f).split(sep).join('/'))];
      const src = readFileSync(resolve('src/sw.js'), 'utf8')
        .replace('__VERSION__', hash.digest('hex').slice(0, 12))
        .replace('__FILES__', JSON.stringify(urls));
      writeFileSync(join(outDir, 'sw.js'), src);
    },
  };
}

// GitHub Pages serves a project site at /<repo>/, and the repo is named
// GullyScore (case matters in the URL). Dev runs at the root. To host at a
// domain root instead (Cloudflare Pages), build with VITE_BASE=/ .
export default defineConfig(({ command }) => ({
  base: process.env.VITE_BASE || (command === 'build' ? '/GullyScore/' : '/'),
  plugins: [svelte(), serviceWorker()],
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
  },
}));
