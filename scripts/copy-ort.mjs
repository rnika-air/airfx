// Copies the ONNX Runtime WebAssembly files next to the app, so AI inference
// does not depend on a CDN. Runs before `npm run dev` and `npm run build`.
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const from = 'node_modules/onnxruntime-web/dist';
const to = 'public/ort';
if (existsSync(from)) {
  mkdirSync(to, { recursive: true });
  for (const f of readdirSync(from)) {
    if (!/^ort-wasm-simd-threaded(\.jsep|\.asyncify)?\.(wasm|mjs)$/.test(f)) continue;
    const dest = join(to, f);
    if (!existsSync(dest) || statSync(dest).size !== statSync(join(from, f)).size) cpSync(join(from, f), dest);
  }
}
