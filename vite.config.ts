import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The ONNX runtime imports its .mjs loader from /ort/ at run time. Vite's dev
 * server refuses JavaScript imports from public/, so these files are answered
 * before its transform step. A production build serves them as plain files.
 */
const MEDIAPIPE = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm'];

function serveOrt(): Plugin {
  return {
    name: 'airfx-serve-ort',
    // MediaPipe's runtime is served from the package, so the build copies it next to the app.
    closeBundle() {
      const out = join(process.cwd(), 'dist', 'mediapipe');
      if (!existsSync(join(process.cwd(), 'dist'))) return;
      mkdirSync(out, { recursive: true });
      for (const f of MEDIAPIPE) copyFileSync(join(process.cwd(), 'node_modules', '@mediapipe', 'tasks-vision', 'wasm', f), join(out, f));
    },
    configureServer(server) {
      server.middlewares.use('/mediapipe', (req, res, next) => {
        const name = basename((req.url ?? '').split('?')[0]);
        if (!MEDIAPIPE.includes(name)) return next();
        res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        res.setHeader('Cache-Control', 'no-cache');
        createReadStream(join(server.config.root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm', name)).pipe(res);
      });
      server.middlewares.use('/ort', (req, res, next) => {
        const name = basename((req.url ?? '').split('?')[0]);
        const file = join(server.config.root, 'public', 'ort', name);
        if (!name || !existsSync(file)) return next();
        res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        res.setHeader('Cache-Control', 'no-cache');
        createReadStream(file).pipe(res);
      });
    },
  };
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
const ortVersion = (JSON.parse(readFileSync('node_modules/onnxruntime-web/package.json', 'utf8')) as { version: string }).version;
/**
 * AIRFX_ORT_SOURCE=cdn: the ONNX runtime files (up to 27 MB each) load from
 * jsDelivr, pinned to the installed version, instead of shipping with the app.
 * Cloudflare Pages refuses files over 25 MiB, so its builds use this.
 */
const ortFromCdn = process.env.AIRFX_ORT_SOURCE === 'cdn';
const ORT_BASE = ortFromCdn ? `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ortVersion}/dist/` : '/ort/';
const MAX_FILE = 25 * 1024 * 1024;

/**
 * After a production build: drop runtime files that load from the CDN, check
 * the host's per-file limit, and write the service worker with the exact list
 * of app-shell files to cache for offline use.
 */
function finishBuild(): Plugin {
  return {
    name: 'airfx-finish-build',
    apply: 'build',
    closeBundle() {
      const dist = join(process.cwd(), 'dist');
      if (!existsSync(dist)) return;
      const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
      if (ortFromCdn) {
        rmSync(join(dist, 'ort'), { recursive: true, force: true });
        for (const f of walk(join(dist, 'assets'))) if (/ort-wasm.*\.wasm$/.test(f)) rmSync(f);
        const big = walk(dist).filter((f) => statSync(f).size > MAX_FILE);
        if (big.length) throw new Error(`Files over 25 MiB cannot be deployed: ${big.map((f) => relative(dist, f)).join(', ')}`);
      }
      // Offline shell: pages, scripts, styles, icons. Not the large runtimes (cached on first use).
      const files = walk(dist).map((f) => '/' + relative(dist, f).replace(/\\/g, '/'))
        .filter((u) => !u.startsWith('/ort/') && !u.startsWith('/mediapipe/') && !u.startsWith('/samples/') && !/\.(wasm|map)$/.test(u) && u !== '/sw.js' && !u.startsWith('/_'));
      const shell = ['/', ...files].filter((u) => u === '/' || statSync(join(dist, u)).size < 8 * 1024 * 1024);
      const template = readFileSync(join(process.cwd(), 'src', 'pwa', 'sw-template.js'), 'utf8');
      writeFileSync(join(dist, 'sw.js'), template.split("'__VERSION__'").join(`'${pkg.version}-${Date.now().toString(36)}'`).split('= __PRECACHE__;').join(`= ${JSON.stringify(shell)};`));
    },
  };
}

export default defineConfig({
  plugins: [serveOrt(), react(), finishBuild()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __ORT_BASE__: JSON.stringify(ORT_BASE) },
  server: {
    port: 5173,
    open: false,
    // Large runtime files never change while editing, and watching them can
    // crash the server with EBUSY on Windows.
    // Polling: native file events were missed on this drive, serving stale code.
    watch: { ignored: ['**/public/ort/**', '**/dist/**'], usePolling: true, interval: 400 },
  },
  // These are imported by the AI worker or by code loaded later. Listed here so they are
  // built at startup. Otherwise the first model click finds them, Vite rebuilds and
  // reloads the page under the user, and the worker's imports answer 504.
  optimizeDeps: { include: ['@huggingface/transformers', 'onnxruntime-web/webgpu', 'mediabunny', '@mediapipe/tasks-vision'] },
  // transformers.js must stay a real module so its WASM loading works in the worker.
  worker: { format: 'es' },
});
