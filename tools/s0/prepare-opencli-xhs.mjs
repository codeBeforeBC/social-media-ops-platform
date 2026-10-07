/** Apply the verified visibility patch only to the exact OpenCLI 1.8.8 file. */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const ORIGINAL = '8d7ddf09afbc913a8dcff916363aad182fce78f072aa96e70d45fbf9aa84a435';
const PATCHED = 'e64cab1dd64c5e3138c94b43c6efab35861fc66bd34d3cec113f5faa4af8f7e2';
const hash = value => createHash('sha256').update(value).digest('hex');

export function prepareSearch(source) {
  const before = hash(source);
  if (before === PATCHED) return { source, changed: false, sha256: PATCHED };
  if (before !== ORIGINAL) throw new Error('Source hash mismatch; refusing to patch an unknown adapter');
  const replacement = source.replace(
    "const visible = (element) => {\n          if (!element) return false;",
    "const visible = (element) => {\n          if (!element || element.closest('[aria-hidden=\"true\"]')) return false;",
  ).replace(
    "          return rect.width > 0 && rect.height > 0 &&\n            style.display !== 'none' && style.visibility !== 'hidden';",
    "          return Number(style.opacity) > 0.05 && rect.width > 0 && rect.height > 0 &&\n            style.display !== 'none' && style.visibility !== 'hidden';",
  );
  if (hash(replacement) !== PATCHED) throw new Error('Patched hash mismatch; refusing to write');
  return { source: replacement, changed: true, sha256: PATCHED };
}

async function main() {
  if (process.argv.length !== 4 || process.argv[2] !== '--opencli-root') throw new Error('Use --opencli-root DIR');
  const root = path.resolve(process.argv[3]);
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (pkg.name !== '@jackwener/opencli' || pkg.version !== '1.8.8') throw new Error('Requires OpenCLI 1.8.8');
  const file = path.join(root, 'clis/xiaohongshu/search.js');
  const source = await readFile(file, 'utf8');
  const prepared = prepareSearch(source);
  if (prepared.changed) await writeFile(file, prepared.source);
  console.log(JSON.stringify({ version:pkg.version, changed:prepared.changed, sha256:prepared.sha256 }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode=1; });
}
