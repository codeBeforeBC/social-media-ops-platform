/** Server-side/local CLI only. Secret-bearing configuration is accepted via stdin, never argv. */
import {readFileSync,writeFileSync,renameSync,mkdirSync,chmodSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {loadAIConfig,parseAIConfig,AIFailure} from '../packages/domain/src/ai-gateway';
async function main(){
 const mode=process.argv[2]??'status',path=resolve(process.env.AI_CONFIG_FILE??'.local/ai/deepseek.json');
 if(mode==='status'){const c=loadAIConfig();console.log(JSON.stringify({configured:true,enabled:c.enabled,provider:c.provider,model:c.model,budget_mode:c.budget.mode,pricing_configured:!!c.pricing}));return;}
 let raw:unknown;
 if(mode==='set'){const text=readFileSync(0,'utf8');if(Buffer.byteLength(text)>16384)throw new AIFailure('AI_CONFIG_TOO_LARGE');raw=JSON.parse(text);}
 else if(mode==='enable'||mode==='disable')raw={...loadAIConfig(),enabled:mode==='enable'};
 else throw new AIFailure('AI_CONFIG_COMMAND_INVALID');
 const c=parseAIConfig(raw);mkdirSync(dirname(path),{recursive:true,mode:0o700});const temp=path+'.'+randomUUID()+'.tmp';writeFileSync(temp,JSON.stringify(c,null,2)+'\n',{mode:0o600,flag:'wx'});renameSync(temp,path);chmodSync(path,0o600);console.log(JSON.stringify({saved:true,enabled:c.enabled,provider:c.provider,model:c.model}));
}
main().catch(e=>{console.error(JSON.stringify({error_code:e instanceof AIFailure?e.code:'AI_CONFIG_INVALID'}));process.exitCode=1;});
