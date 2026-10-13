/** One cross-day acceptance run; no clock changes, recurring installation, model calls or use-volume replacement. */
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const version='0.1.0-s9rc15',base=resolve('.local/s9-clean-clone/.local/clean-use/actual-A-backup-4');
const baseline=JSON.parse(readFileSync('docs/evidence/s9/restore-real-state-rc15.json'));
assert.equal(baseline.artifact,version);assert.equal(baseline.result,'passed_actual_A_state_restore_scope');
const point=statSync(base+'/SHA256SUMS').mtimeMs,deadline=point+23*3600000;
assert.ok(Date.now()<deadline,'cross-day probe must start before the next backup deadline');
const report={artifact:version,classification:'one_actual_cross_day_backup_restore_acceptance_window_not_production_SLA',pid:process.pid,base_backup_completed_at:new Date(point).toISOString(),due_at:new Date(deadline).toISOString(),state:'waiting',real_model_requests:0};
const save=()=>writeFileSync('docs/evidence/s9/daily-rpo-probe.json',JSON.stringify(report,null,2)+'\n');
save();console.log(JSON.stringify({pid:process.pid,state:report.state,due_at:report.due_at}));
try{
 while(Date.now()<deadline)await new Promise(r=>setTimeout(r,Math.min(60000,deadline-Date.now())));
 // Reject changed product code instead of restoring with an outdated release.
 const manifest=JSON.parse(readFileSync('.local/releases/'+version+'/manifest.json'));
 for(const f of manifest.source_files.filter(f=>f.path.startsWith('apps/')||f.path.startsWith('packages/'))){assert.equal(createHash('sha256').update(readFileSync(f.path)).digest('hex'),f.sha256,f.path);}
 const attempt=String(Date.now()),run=spawnSync(process.execPath,['tools/s9/restore-real-state.mjs',attempt,version],{stdio:'inherit'});assert.equal(run.status,0);
 const restored=JSON.parse(readFileSync('docs/evidence/s9/restore-real-state.json'));assert.equal(restored.result,'passed_actual_A_state_restore_scope');assert.equal(restored.new_model_requests,0);
 const interval=statSync(resolve('.local/s9-clean-clone/.local/clean-use/actual-A-backup-'+attempt+'/SHA256SUMS')).mtimeMs-point;
 assert.ok(interval>=22*3600000&&interval<=24*3600000,'actual cross-day backup interval must stay within RPO');assert.ok(restored.restore_healthy_ms<=4*3600000);
 report.backup_interval_ms=interval;report.restore_healthy_ms=restored.restore_healthy_ms;report.table_count=restored.table_count;report.real_originals_count=restored.real_originals_count;report.state='passed';
 writeFileSync('docs/evidence/s9/cross-day-restoration.json',JSON.stringify(restored,null,2)+'\n');
}catch(e){report.state='failed';report.failure=String(e.message).slice(0,1000);process.exitCode=1;}
finally{save();console.log(JSON.stringify({state:report.state,backup_interval_ms:report.backup_interval_ms}));}
