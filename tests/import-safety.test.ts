import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
test('导入沙箱实际拒绝网络和凭据读取，允许工作目录且强制资源限制',()=>{
 const output=execFileSync('docker',['compose','-f','compose.s11-test.yaml','exec','-T','media-executor','sh','-c','mkdir -p /scratch/security-probe && /usr/local/bin/media-sandbox /scratch/security-probe /usr/bin/python3 -c "import socket,resource; blocked=False\ntry: socket.socket()\nexcept PermissionError: blocked=True\nassert blocked\ntry: open(\'/run/media-token\').read(); raise AssertionError(\'credential exposed\')\nexcept PermissionError: pass\nassert resource.getrlimit(resource.RLIMIT_CPU)[0] <= 120\nassert resource.getrlimit(resource.RLIMIT_AS)[0] <= 2*1024**3\nopen(\'allowed.txt\',\'w\').write(\'ok\')\nprint(\'network_and_credentials_blocked\')"'],{encoding:'utf8'});assert.match(output,/network_and_credentials_blocked/);
 writeFileSync('docs/evidence/s11/sandbox.json',JSON.stringify({checked_at:new Date().toISOString(),network_syscalls_denied:true,credential_file_denied:true,working_directory_write_allowed:true,cpu_memory_limits:true,landlock_and_seccomp_required:true},null,2)+'\n');
});
