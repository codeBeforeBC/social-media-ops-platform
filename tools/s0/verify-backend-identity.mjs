/** Match the authorized backend display number to the logged-in public profile; emit hashes only. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root='.local/s9-creator-probe/',files=['own-profile-20261012.json','own-identity-20261012.json','own-notes-20261012.json','profile-raw.json','graphic-base.json'];
const json=f=>JSON.parse(readFileSync(root+f)),sha=v=>createHash('sha256').update(v).digest('hex');
const own=json(files[0]),profile=json(files[1]),feed=json(files[2]),backend=json(files[3]),graphic=json(files[4]);
assert.equal(own.security_block,false);assert.equal(own.login_wall,false);assert.equal(profile.security_block,false);assert.equal(profile.login_wall,false);
assert.ok(own.own_links.length>0);assert.ok(own.own_links.every(a=>a.label==='我'&&new URL(a.href).pathname===profile.path));
assert.match(feed.id,/^[a-f0-9]{24}$/);assert.equal(profile.path,'/user/profile/'+feed.id);assert.equal(backend.body.success,true);assert.ok(profile.text.includes(backend.body.data.red_num));
assert.equal(graphic.status,200);assert.equal(graphic.body.success,true);assert.ok(feed.notes.some(n=>n.id===graphic.body.data.note_info.id));
const report={checked_at:new Date().toISOString(),classification:'real_authorized_account_identity_readonly',identity_namespace:'platform_internal_user_id',account_identity_sha256:sha(feed.id),backend_display_number_sha256:sha(backend.body.data.red_num),own_link_matches_profile:true,backend_display_number_matches_profile:true,graphic_note_belongs_to_profile:true,public_note_count:feed.notes.length,public_media_types:feed.notes.reduce((c,n)=>(c[n.type]=(c[n.type]??0)+1,c),{}),video_backend_sample:'missing',sources:files.map(f=>({private_path:root+f,sha256:sha(readFileSync(root+f))})),credentials_printed:false,result:'passed_identity_mapping_only'};
writeFileSync('docs/evidence/s0/backend-identity.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,public_note_count:report.public_note_count,types:report.public_media_types,video:'missing'}));
