import test from 'node:test';
import assert from 'node:assert/strict';
import { noteIdentity, normalizeCount, normalizeDetail, prepareNavigation, NO_HTTP_CAPTURE } from './probe-xhs-navigation.mjs';
import { prepareSearch } from './prepare-opencli-xhs.mjs';
const id = '0123456789abcdef01234567';
const fixture = () => ({ pageUrl: `https://www.xiaohongshu.com/explore/${id}?xsec_token=synthetic-test-token`, hasDetailPanel:true, loaded:true, author:'fixture', title:'fixture', desc:'public text', likes:'0', collects:'收藏', comments:'1.1万', dateLabel:'4天前', mediaType:'image' });

test('URL normalization strips the synthetic signature and rejects unrelated hosts/paths', () => {
  assert.equal(noteIdentity(fixture().pageUrl).canonical_url, `https://www.xiaohongshu.com/explore/${id}`);
  for (const raw of ['https://evil.example/explore/'+id, 'http://www.xiaohongshu.com/explore/'+id, 'https://www.xiaohongshu.com/user/profile/'+id]) assert.throws(() => noteIdentity(raw), {code:'INVALID_INPUT'});
});
test('missing counters remain null; zero and abbreviated counts retain distinct semantics', () => {
  assert.equal(normalizeCount('赞').value, null);
  assert.equal(normalizeCount('').value, null);
  assert.equal(normalizeCount('0').value, 0);
  assert.deepEqual(normalizeCount('1.1万'), {raw:'1.1万',value:11000,approximate:true});
});
test('wrong note ID cannot become a successful detail', () => {
  assert.throws(() => normalizeDetail(fixture(),'aaaaaaaaaaaaaaaaaaaaaaaa'), {code:'SOURCE_CHANGED'});
});
test('login, security control and unavailable content stop instead of becoming empty notes', () => {
  for (const [flag,code] of [['loginWall','AUTH_REQUIRED'],['securityBlock','ACCESS_DENIED'],['notFound','CONTENT_UNAVAILABLE']]) assert.throws(() => normalizeDetail({...fixture(),[flag]:true},id), {code});
});
test('loading timeout and absent panel cannot become success', () => {
  assert.throws(() => normalizeDetail({...fixture(),loaded:false},id), {code:'TIMEOUT'});
  assert.throws(() => normalizeDetail({...fixture(),hasDetailPanel:false},id), {code:'SOURCE_CHANGED'});
});
test('normalized evidence has no signature/full body or invented precise date', () => {
  const data=normalizeDetail(fixture(),id);
  assert.equal(data.published_at,null); assert.equal(data.date_label_raw,'4天前');
  assert.equal(data.visible_counts.collects.value,null);
  assert.equal(data.body_chars,11);
  assert.ok(!JSON.stringify(data).includes('synthetic-test-token'));
  assert.ok(!JSON.stringify(data).includes('public text'));
});
test('Live Photo remains image metadata while preserving its separate flag', () => {
  const data=normalizeDetail({...fixture(),mediaType:'image',hasLivePhoto:true},id);
  assert.equal(data.media_type,'image');
  assert.equal(data.has_live_photo,true);
});
test('debugger preparation uses a non-HTTP pattern and fails closed when unsupported', async () => {
  let pattern;
  await prepareNavigation({startNetworkCapture:async value => {pattern=value;return true;}});
  assert.equal(pattern,NO_HTTP_CAPTURE);
  await assert.rejects(prepareNavigation({startNetworkCapture:async () => false}), {code:'BRIDGE_UNSUPPORTED'});
});
test('dependency drift fails before writing a visibility patch', () => {
  assert.throws(() => prepareSearch('unknown upstream revision'), /Source hash mismatch/);
});
