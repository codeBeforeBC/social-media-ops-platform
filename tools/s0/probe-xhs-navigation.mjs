/** Bounded S0 navigation verification, not a product collector. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { classifyDetailMedia } from './xhs-detail-media.mjs';

export const NO_HTTP_CAPTURE = 'opencli://yoyo-navigation-no-http-match/';
const EXPECTED_SEARCH_HASH = 'e64cab1dd64c5e3138c94b43c6efab35861fc66bd34d3cec113f5faa4af8f7e2';
const sha256 = value => createHash('sha256').update(value).digest('hex');
function fail(code, message) { throw Object.assign(new Error(message), { code }); }

export function noteIdentity(raw) {
  let url;
  try { url = new URL(raw); } catch { fail('INVALID_INPUT', 'Expected a full signed Xiaohongshu URL'); }
  if (url.protocol !== 'https:' || url.hostname !== 'www.xiaohongshu.com' || url.port || url.username || url.password) {
    fail('INVALID_INPUT', 'Unexpected note host or protocol');
  }
  const id = url.pathname.match(/^\/(?:explore|search_result)\/([a-f0-9]{24})\/?$/i)?.[1] ?? url.pathname.match(/^\/user\/profile\/[a-f0-9]{24}\/([a-f0-9]{24})\/?$/i)?.[1];
  if (!id) fail('INVALID_INPUT', 'Unexpected note path');
  return { id: id.toLowerCase(), canonical_url: `https://www.xiaohongshu.com/explore/${id.toLowerCase()}` };
}

export function normalizeCount(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  const match = value.match(/^(\d+(?:\.\d+)?)(万|亿)?$/);
  if (!match) return { raw: value || null, value: null, approximate: false };
  return { raw: value, value: Number(match[1]) * (match[2] === '万' ? 10000 : match[2] === '亿' ? 100000000 : 1), approximate: Boolean(match[2]) };
}

export function normalizeDetail(data, expectedId) {
  if (!data || typeof data !== 'object') fail('PARSE_FAILED', 'No detail payload');
  if (data.securityBlock) fail('ACCESS_DENIED', 'Page shows security controls; stop this source');
  if (data.loginWall) fail('AUTH_REQUIRED', 'Page requires manual login');
  if (data.notFound) fail('CONTENT_UNAVAILABLE', 'Note is unavailable');
  const identity = noteIdentity(data.pageUrl);
  if (identity.id !== expectedId) fail('SOURCE_CHANGED', 'Detail ID does not match the selected note');
  if (!data.hasDetailPanel || !data.author) fail('SOURCE_CHANGED', 'Expected rendered note panel and author');
  if (data.loaded !== true) fail('TIMEOUT', 'Detail fields did not settle within the bounded wait');
  return {
    external_id: identity.id, canonical_url: identity.canonical_url,
    title: data.title || null, body_chars: data.desc?.length || 0,
    body_sha256: sha256(data.desc || ''), author_present: true,
    date_label_raw: data.dateLabel || null, published_at: null,
    media_type: data.mediaType || 'unknown',
    has_live_photo: data.hasLivePhoto === true,
    visible_counts: { likes: normalizeCount(data.likes), collects: normalizeCount(data.collects), comments: normalizeCount(data.comments) },
  };
}

export async function prepareNavigation(page) {
  // Keeps the debugger attached through navigate without recording HTTP bodies.
  // This is a Bridge compatibility workaround, not an access-control retry.
  if (await page.startNetworkCapture(NO_HTTP_CAPTURE) !== true) {
    fail('BRIDGE_UNSUPPORTED', 'Cannot establish the debugger-preserving navigation path');
  }
}

function options(args) {
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--opencli-root', '--profile', '--output'].includes(args[i]) || !args[i + 1]) fail('INVALID_INPUT', 'Use --opencli-root DIR --profile ID --output FILE');
    opts[args[i].slice(2)] = args[i + 1];
  }
  for (const name of ['opencli-root', 'profile', 'output']) if (!opts[name]) fail('INVALID_INPUT', `Missing --${name}`);
  return opts;
}

export async function main(args) {
  const opts = options(args);
  const root = path.resolve(opts['opencli-root']);
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (pkg.name !== '@jackwener/opencli' || pkg.version !== '1.8.8') fail('DEPENDENCY_CHANGED', 'Requires OpenCLI 1.8.8');
  const searchFile = path.join(root, 'clis/xiaohongshu/search.js');
  if (sha256(await readFile(searchFile)) !== EXPECTED_SEARCH_HASH) fail('DEPENDENCY_CHANGED', 'Search adapter visibility patch/hash does not match the verified version');
  const { Page } = await import(pathToFileURL(path.join(root, 'dist/src/browser/page.js')).href);
  const { command: search } = await import(pathToFileURL(searchFile).href);
  const { NOTE_EXTRACT_JS } = await import(pathToFileURL(path.join(root, 'clis/xiaohongshu/note.js')).href);
  const page = new Page(`yoyo-nav:${randomUUID()}`, 60, opts.profile, 'background', 'adapter', 'ephemeral');
  const report = {
    started_at: new Date().toISOString(), profile: opts.profile, cli: pkg.version,
    search_adapter_sha256: EXPECTED_SEARCH_HASH, source_type: 'keyword_search',
    navigation_strategy: 'debugger remains attached; non-HTTP capture pattern; no navigation retries',
    searches: [], details: [], detail_diagnostics: [], steps: [],
  };
  async function step(name, fn) {
    const began = Date.now();
    try { const value = await fn(); report.steps.push({ name, ok: true, elapsed_ms: Date.now() - began }); return value; }
    catch (error) {
      report.steps.push({ name, ok: false, elapsed_ms: Date.now() - began, code: error.code || 'UNKNOWN', error: String(error.message || error).replace(/https?:\/\/[^\s"']+/g, '[url-redacted]') });
      throw error;
    }
  }
  const detailJs = expectedId => `
    (async () => {
      const deadline = Date.now() + 12000;
      let previous = '', stable = 0, result;
      while (Date.now() < deadline) {
        const d = ${NOTE_EXTRACT_JS};
        const panel = document.querySelector('#noteContainer');
        d.hasDetailPanel = Boolean(panel);
        d.dateLabel = panel?.querySelector('.date')?.textContent?.trim() || null;
        const media = (${classifyDetailMedia.toString()})(panel);
        d.mediaType = media.type;
        d.hasLivePhoto = media.has_live_photo;
        const id = location.pathname.match(/\\/(?:explore|search_result)\\/([a-f0-9]{24})/i)?.[1]?.toLowerCase();
        if (d.securityBlock || d.loginWall || d.notFound) return {...d, loaded:false};
        const value = JSON.stringify([id, d.title, d.desc, d.author, d.likes, d.collects, d.comments, d.dateLabel, d.mediaType, d.hasLivePhoto]);
        stable = value === previous ? stable + 1 : 0;
        previous = value; result = d;
        if (id === ${JSON.stringify(expectedId)} && panel && d.author && d.mediaType !== 'unknown' && stable >= 2) return {...d, loaded:true};
        await new Promise(resolve => setTimeout(resolve, 400));
      }
      return {...result, loaded:false};
    })()`;
  try {
    await step('prepare_debugger_preserving_navigation', () => prepareNavigation(page));
    const matrix = [
      { keyword: '旅行', sort: 'comprehensive', type: 'image', detail: true },
      { keyword: '潮玩', sort: 'comprehensive', type: 'video', detail: true },
      { keyword: '情绪价值', sort: 'comprehensive', type: 'all', detail: true },
      { keyword: '旅行', sort: 'latest', type: 'all', detail: false },
    ];
    for (const item of matrix) {
      const rows = await step(`search:${item.keyword}:${item.sort}:${item.type}`, () => search.func(page, { query: item.keyword, limit: 3, sort: item.sort, 'note-type': item.type, 'publish-time': 'anytime', scope: 'all', location: 'all' }));
      if (!Array.isArray(rows) || !rows.length || rows.length > 3) fail('PARSE_FAILED', 'Unexpected bounded search result');
      const identities = rows.map(row => noteIdentity(row.url));
      if (new Set(identities.map(identity => identity.id)).size !== identities.length) fail('SOURCE_CHANGED', 'Search IDs are not unique');
      report.searches.push({ keyword: item.keyword, sort: item.sort, requested_note_type: item.type, count: rows.length, items: rows.map((row, i) => ({ external_id: identities[i].id, canonical_url: identities[i].canonical_url, title: row.title || null, search_position: i + 1, published_at: null })) });
      if (item.detail) {
        const selected = rows[0];
        if (!new URL(selected.url).searchParams.get('xsec_token')) fail('INVALID_INPUT', 'Selected result is missing a signed navigation URL');
        await new Promise(resolve => setTimeout(resolve, 3000));
        await step(`detail_navigation:${item.keyword}`, () => page.goto(selected.url));
        const data = await step(`detail_read:${item.keyword}`, () => page.evaluate(detailJs(identities[0].id)));
        report.detail_diagnostics.push({
          keyword: item.keyword, expected_id: identities[0].id,
          path: data?.pageUrl ? new URL(data.pageUrl).pathname : null,
          has_panel: Boolean(data?.hasDetailPanel), author_present: Boolean(data?.author),
          loaded: data?.loaded === true, login_wall: Boolean(data?.loginWall),
          security_block: Boolean(data?.securityBlock), not_found: Boolean(data?.notFound),
          media_type: data?.mediaType || 'unknown', requested_note_type: item.type,
          has_live_photo: data?.hasLivePhoto === true,
        });
        const detail = await step(`detail_validate:${item.keyword}`, async () => {
          const normalized = normalizeDetail(data, identities[0].id);
          if (item.type !== 'all' && normalized.media_type !== item.type) fail('SOURCE_CHANGED', 'Detail media type does not match the requested filter');
          return normalized;
        });
        report.details.push({ keyword: item.keyword, captured_at: new Date().toISOString(), ...detail });
      }
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    report.captured_http_entries = (await page.readNetworkCapture()).length;
    if (report.captured_http_entries !== 0) fail('UNEXPECTED_CAPTURE', 'Nonmatching capture pattern unexpectedly recorded HTTP entries');
    report.ok = true;
  } catch (error) {
    report.ok = false;
    report.failure_code = error.code || 'UNKNOWN';
    report.failure_message = String(error.message || error).replace(/https?:\/\/[^\s"']+/g, '[url-redacted]');
    process.exitCode = 1;
  } finally {
    await page.closeWindow();
    report.finished_at = new Date().toISOString();
    const out = path.resolve(opts.output);
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify({ ok: report.ok, profile: report.profile, searches: report.searches.map(x => ({keyword:x.keyword,sort:x.sort,type:x.requested_note_type,count:x.count})), details: report.details.map(x => ({keyword:x.keyword,id:x.external_id,type:x.media_type})), failure_code: report.failure_code, failed_steps: report.steps.filter(x => !x.ok), output: out }));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(`${error.code || 'UNKNOWN'}: ${error.message}`); process.exitCode = 1; });
}
