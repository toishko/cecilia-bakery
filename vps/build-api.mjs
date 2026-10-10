// Each function in api/ turned into one plain Node file in vps/.out/api/, the way Vercel's build does it:
// the files mix `export default` with `module.exports.config` and import ./lib/, which Node can't load as they are.
// Packages (sharp, @supabase/supabase-js) stay outside, installed in the image.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const names = fs.readdirSync(path.join(ROOT, 'api')).filter((f) => f.endsWith('.js'));
await build({
  entryPoints: names.map((f) => path.join(ROOT, 'api', f)),
  outdir: path.join(ROOT, 'vps', '.out', 'api'),
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  packages: 'external',
  logLevel: 'error',
});
console.log(`api: ${names.length} functions built (${names.map((f) => f.replace(/\.js$/, '')).join(', ')})`);
