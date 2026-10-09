import 'reflect-metadata';
import {All,Controller,Module,Req,Res,Inject,Catch,ExceptionFilter,ArgumentsHost,HttpException} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {NestExpressApplication} from '@nestjs/platform-express';
import {Request,Response,NextFunction} from 'express';
import cookieParser from 'cookie-parser';
import {raw} from 'express';
import {Files} from './files';
import {Assets} from './assets';
import {AIRequests} from './ai';
import {Topics} from './topics';
import {Contents} from './contents';
import {Collection} from '../../../packages/domain/src/collection';
import {SourceEvidence} from '../../../packages/domain/src/source-evidence';
import helmet from 'helmet';
import {resolve} from 'node:path';
import {Database} from '../../../packages/db/src/db';
import {AppError,id,parse,uuid,authorize,Permission} from '../../../packages/domain/src/protocol';
import {config} from '../../../packages/domain/src/config';
import {Auth,cookieName,resRequestId} from './auth';
import {Commands,safeJob,Result,audit} from './commands';
const DB='DATABASE';
@Controller('api/v1')
class ApiController {
  private readonly auth:Auth;private readonly commands:Commands;private readonly files:Files;
  constructor(@Inject(DB) readonly db:Database){this.auth=new Auth(db);this.commands=new Commands(db);this.files=new Files(db);}
  @All('{*path}')
  async route(@Req() req:Request,@Res() res:Response){
    const path=req.originalUrl.split('?')[0]!.replace(/^\/api\/v1/,'');const method=req.method;
    const send=(data:unknown,status=200)=>res.status(status).json({data,meta:{request_id:resRequestId(req),server_time:new Date().toISOString()}});
    if(method==='GET'&&path==='/health'){await this.db.query('SELECT 1');return send({status:'ok'});}
    if(method==='GET'&&path==='/setup/status'){const r=await this.db.query('SELECT initialized_at FROM instance_state WHERE id=1');return send({initialized:!!r.rows[0]?.initialized_at});}
    if(method==='GET'&&path==='/auth/csrf')return send(await this.auth.csrf(req,res));
    if(method==='POST'&&path==='/setup')return send(await this.auth.setup(req),201);
    if(method==='POST'&&path==='/auth/login')return send(await this.auth.login(req,res));
    if(method==='POST'&&path==='/auth/accept-invite')return send(await this.auth.acceptInvite(req));
    const a=await this.auth.actor(req);authorize(a,'read');
    if(method!=='GET'&&method!=='HEAD')await this.auth.checkCsrf(req);
    const c=this.commands;
    const command=async(permission:Permission,fn:Parameters<Commands['command']>[6])=>{const r=await c.command(a,req.headers['idempotency-key'],method,path,req.body??{},permission,fn);return send(r.data,r.status);};
    const contents=new Contents(this.db);
    if(path==='/contents'&&method==='GET')return send(await contents.list(a,req.query));
    const content=path.match(/^\/contents\/([^/]+)(?:\/(generate-brief|apply-generated))?$/);if(content){if(method==='GET'&&!content[2])return send(await contents.detail(a,content[1]!));if(method==='POST'&&content[2]==='generate-brief')return command('content.production',(tx,actor)=>contents.generate(tx,actor,content[1]!,req.body));if(method==='POST'&&content[2]==='apply-generated')return command('content.production',(tx,actor)=>contents.apply(tx,actor,content[1]!,req.body));}
    const topics=new Topics(this.db);
    if(path==='/topics'&&method==='GET')return send(await topics.list(a,req.query));
    const topic=path.match(/^\/topics\/([^/]+)(?:\/(accept|reject|variants))?$/);
    if(topic){if(method==='GET'&&!topic[2])return send(await topics.detail(a,topic[1]!));if(method==='POST'&&topic[2]==='accept')return command('content.copy',(tx,actor)=>topics.accept(tx,actor,topic[1]!,req.body));if(method==='POST'&&topic[2]==='reject')return command('content.copy',(tx,actor)=>topics.reject(tx,actor,topic[1]!,req.body));if(method==='POST'&&topic[2]==='variants')return command('content.copy',(tx,actor)=>topics.variant(tx,actor,topic[1]!,req.body));}
    const ai=new AIRequests(this.db);
    if(path==='/topic-generations'&&method==='POST')return command('content.copy',(tx,actor)=>ai.generateTopics(tx,actor,req.body));
    const aiRequest=path.match(/^\/ai-requests\/([^/]+)$/);if(aiRequest&&method==='GET')return send(await ai.get(a,aiRequest[1]!));
    const sourceEvidence=new SourceEvidence(this.db);
    if(path==='/source-items'&&method==='GET')return send(await sourceEvidence.list(a,req.query));
    const sourceItem=path.match(/^\/source-items\/([^/]+)$/);if(sourceItem&&method==='GET')return send(await sourceEvidence.detail(a,sourceItem[1]!));
    const collection=new Collection(this.db);
    if(path==='/source-connections'){if(method==='GET')return send(await collection.list(a));if(method==='POST')return command('admin',(tx,actor)=>collection.create(tx,actor,req.body));}
    const source=path.match(/^\/source-connections\/([^/]+)(?:\/(refresh|verify|runs|pause))?$/);
    if(source){const sid=source[1]!;if(method==='GET'&&!source[2])return send(await collection.scope(this.db,a,sid));if(method==='PATCH'&&!source[2])return command('admin',(tx,actor)=>collection.patch(tx,actor,sid,req.body));if(method==='GET'&&source[2]==='runs')return send(await collection.runs(a,sid));if(method==='POST'&&['refresh','verify'].includes(source[2]!))return command('operate',(tx,actor)=>collection.refresh(tx,actor,sid,source[2]==='verify'));if(method==='POST'&&source[2]==='pause')return command('operate',(tx,actor)=>collection.pause(tx,actor,sid,req.body));}
    const files=this.files;
    if(path==='/uploads'&&method==='POST')return command('asset.edit',(tx,actor)=>files.create(tx,actor,req.body));
    const upload=path.match(/^\/uploads\/([^/]+)(?:\/(parts|complete|abort)(?:\/(\d+))?)?$/);
    if(upload){const uid=upload[1]!;if(method==='GET'&&!upload[2])return send(await files.get(a,uid));if(method==='POST'&&upload[2]==='parts')return command('asset.edit',(tx,actor)=>files.register(tx,actor,uid,req.body));if(method==='PUT'&&upload[2]==='parts'&&upload[3])return send(await files.put(a,uid,Number(upload[3]),req.body));if(method==='POST'&&upload[2]==='complete')return command('asset.edit',(tx,actor)=>files.finish(tx,actor,uid,req.body));if(method==='POST'&&upload[2]==='abort')return command('asset.edit',(tx,actor)=>files.abort(tx,actor,uid,req.body));}
    const assets=new Assets(this.db,files);
    if(path==='/assets'){if(method==='GET')return send(await assets.list(a,req.query));if(method==='POST')return command('asset.edit',(tx,actor)=>assets.create(tx,actor,req.body));}
    const asset=path.match(/^\/assets\/([^/]+)(?:\/(versions|retire|confirm|usages|favorite))?$/);
    if(asset){const aid=asset[1]!;if(method==='GET'&&!asset[2])return send(await assets.detail(a,aid));if(method==='PATCH'&&!asset[2])return command('asset.edit',(tx,actor)=>assets.patch(tx,actor,aid,req.body));if(method==='GET'&&asset[2]==='versions')return send({items:(await assets.detail(a,aid)).versions});if(method==='POST'&&asset[2]==='versions')return command('asset.edit',(tx,actor)=>assets.newVersion(tx,actor,aid,req.body));if(method==='POST'&&asset[2]==='retire')return command('asset.edit',(tx,actor)=>assets.retire(tx,actor,aid,req.body));if(method==='POST'&&asset[2]==='confirm')return command('review',(tx,actor)=>assets.confirm(tx,actor,aid,req.body));if(method==='GET'&&asset[2]==='usages')return send(await assets.usages(a,aid));if(['PUT','DELETE'].includes(method)&&asset[2]==='favorite')return command('read',(tx,actor)=>assets.favorite(tx,actor,aid,method==='DELETE'));}
    const assetVersionConfirm=path.match(/^\/asset-versions\/([^/]+)\/confirm$/);if(assetVersionConfirm&&method==='POST')return command('review',(tx,actor)=>assets.confirmVersion(tx,actor,assetVersionConfirm[1]!,req.body));
    if(path==='/asset-relations'&&method==='GET')return send(await assets.relations(a,req.query));
    if(path==='/asset-relations'&&method==='POST')return command('asset.edit',(tx,actor)=>assets.relate(tx,actor,req.body));
    if(path==='/asset-usages'&&method==='POST')return command('content.production',(tx,actor)=>assets.use(tx,actor,req.body));
    const revisionAssets=path.match(/^\/content-revisions\/([^/]+)\/assets$/);if(revisionAssets&&method==='GET')return send(await assets.revisionAssets(a,revisionAssets[1]!));
    if(path==='/folders'){if(method==='GET')return send(await assets.folders(a));if(method==='POST')return command('asset.edit',(tx,actor)=>assets.saveFolder(tx,actor,req.body));}
    const folder=path.match(/^\/folders\/([^/]+)$/);if(folder){if(method==='GET')return send(await this.db.transaction(tx=>assets.folder(tx,a,folder[1]!)));if(method==='PATCH')return command('asset.edit',(tx,actor)=>assets.saveFolder(tx,actor,req.body,folder[1]!));}
    const guideFile=path.match(/^\/guideline-files\/([^/]+)$/);if(guideFile&&method==='GET'){const f=await files.file(this.db,a,guideFile[1]!);if(f.detected_mime!=='application/pdf')throw new AppError(404,'NOT_FOUND','规范文件不可见');return send(f);}
    if(path==='/guideline-files'&&method==='GET')return send({items:(await this.db.query("SELECT id,original_name,preview_status,metadata->'pages' pages FROM file_objects WHERE workspace_id=$1 AND detected_mime='application/pdf' AND file_status='ready' AND is_preview=false ORDER BY created_at DESC LIMIT 100",[a.workspaceId])).rows,next_cursor:null});
    if(path==='/rule-sets'){if(method==='GET')return send(await assets.ruleSets(a));if(method==='POST')return command('asset.edit',(tx,actor)=>assets.createRules(tx,actor,req.body));}
    const rule=path.match(/^\/rule-sets\/([^/]+)(?:\/(activate))?$/);if(rule){if(method==='GET'&&!rule[2])return send(await assets.ruleDetail(a,rule[1]!));if(method==='POST'&&rule[2])return command('review',(tx,actor)=>assets.activateRules(tx,actor,rule[1]!,req.body));}
    if(method==='GET'&&(path==='/me'||path==='/auth/session'))return send(await this.auth.me(a));
    if(method==='POST'&&path==='/auth/logout'){
      const r=await c.command(a,req.headers['idempotency-key'],method,path,req.body??{},'read',async(tx,actor)=>{await tx.query('DELETE FROM sessions WHERE token_hash=$1',[a.sessionHash]);await audit(tx,actor,'auth.logout','membership',a.memberId);return {status:200,data:{success:true}};});
      res.clearCookie(cookieName,{path:'/',httpOnly:true,sameSite:'lax',secure:config.secure});return send(r.data,r.status);
    }
    if(method==='GET'&&path==='/accounts')return send(await c.accounts(a));
    if(method==='POST'&&path==='/accounts')return command('admin',(tx,actor)=>c.createAccount(tx,actor,req.body));
    const account=path.match(/^\/accounts\/([^/]+)$/);
    if(account){if(method==='GET')return send(await c.accountScope(this.db,a,account[1]!));if(method==='PATCH')return command('account.edit',(tx,actor)=>c.patchAccount(tx,actor,account[1]!,req.body));}
    if(method==='GET'&&path==='/settings')return send(await c.settings(a));
    if(method==='PATCH'&&path==='/settings')return command('admin',(tx,actor)=>c.patchSettings(tx,actor,req.body));
    if(method==='GET'&&path==='/members')return send(await c.members(a,req.query));
    if(method==='POST'&&path==='/members')return command('admin',(tx,actor)=>c.createMember(tx,actor,req.body));
    const member=path.match(/^\/members\/([^/]+)$/);
    if(member&&method==='PATCH')return command('admin',(tx,actor)=>c.patchMember(tx,actor,member[1]!,req.body));
    if(method==='GET'&&path==='/audit-logs')return send(await c.logs(a,req.query));
    if(method==='GET'&&path==='/notifications')return send(await c.notifications(a,req.query));
    const notification=path.match(/^\/notifications\/([^/]+)\/read$/);
    if(notification&&method==='POST')return command('read',(tx,actor)=>c.readNotification(tx,actor,notification[1]!));
    if(method==='GET'&&path==='/jobs')return send(await c.jobs(a,req.query));
    const job=path.match(/^\/jobs\/([^/]+)(?:\/(cancel|retry))?$/);
    if(job){if(method==='GET'&&!job[2])return send(safeJob(await c.jobScope(this.db,a,job[1]!)));if(method==='POST'&&job[2]==='cancel')return command('job.manage',(tx,actor)=>c.cancelJob(tx,actor,job[1]!,req.body));if(method==='POST'&&job[2]==='retry')return command('admin',(tx,actor)=>c.retryJob(tx,actor,job[1]!,req.body));}
    if(method==='POST'&&path==='/diagnostics')return command('admin',(tx,actor)=>c.diagnostic(tx,actor,req.body));
    if(method==='GET'&&path==='/monitor')return send(await c.monitor(a));
    if(method==='GET'&&path==='/dashboard'){if(req.query.account_id)await c.accountScope(this.db,a,parse(uuid,req.query.account_id));return send({stage:'S1',metrics:null,priority_tasks:[],external_capabilities:{ai:'disabled',ocr:'disabled',sources:'unverified'}});}
    const file=path.match(/^\/files\/([^/]+)\/(download|preview)$/);
    if(file&&method==='GET')return send(await files.link(a,file[1]!,file[2]==='preview',req.query.page===undefined?undefined:Number(req.query.page)));
    throw new AppError(404,'NOT_FOUND','接口不存在或尚未实现');
  }
}
@Catch()
class ApiErrors implements ExceptionFilter {
  catch(e:any,host:ArgumentsHost){const ctx=host.switchToHttp(),res=ctx.getResponse<Response>(),req=ctx.getRequest<Request>();
    let err:AppError;
    if(e instanceof AppError)err=e;
    else if(e.code==='23505')err=new AppError(409,'UNIQUE_CONFLICT','对象或标识已存在');
    else if(e.code==='23503'||e.code==='23514')err=new AppError(422,'RELATION_INVALID','对象关系或字段约束无效');
    else if(e.code==='40P01'||e.code==='40001')err=new AppError(409,'CONCURRENT_CONFLICT','并发操作冲突，请重试',{},true);
    else if(e instanceof HttpException)err=new AppError(e.getStatus(),'HTTP_ERROR','请求无法处理');
    else {err=new AppError(500,'INTERNAL_ERROR','服务暂时无法处理请求',{},true);console.error(JSON.stringify({event:'request.failed',request_id:resRequestId(req),error_code:typeof e.code==='string'?e.code:'INTERNAL_ERROR'}));}
    res.status(err.status).json({error:{code:err.code,message:err.message,field_errors:err.fields,retryable:err.retryable,request_id:resRequestId(req)}});
  }
}
export async function createApp(db=new Database()){
  @Module({controllers:[ApiController],providers:[{provide:DB,useValue:db}]})class ApiModule{}
  const app=await NestFactory.create<NestExpressApplication>(ApiModule,{logger:false});
  app.use((req:Request,res:Response,next:NextFunction)=>{(req as any).requestId=id();res.setHeader('X-Request-Id',resRequestId(req));res.setHeader('Cache-Control','no-store');const start=Date.now();res.on('finish',()=>console.log(JSON.stringify({event:'http.request',request_id:resRequestId(req),method:req.method,path:req.originalUrl.split('?')[0],status:res.statusCode,duration_ms:Date.now()-start})));next();});
  app.use(helmet({contentSecurityPolicy:{directives:{upgradeInsecureRequests:config.secure?[]:null,imgSrc:["'self'",'data:',new URL(process.env.S3_PUBLIC_ENDPOINT??process.env.S3_ENDPOINT??'http://localhost:59000').origin]}}}));
  app.use('/api/v1/uploads',raw({type:'application/octet-stream',limit:8388608}));
  app.use(cookieParser());app.useGlobalFilters(new ApiErrors());
  app.useStaticAssets(resolve('apps/web/dist'),{index:'index.html'});
  await app.init();return app;
}
if(require.main===module){const db=new Database();createApp(db).then(async app=>{
  await app.listen(config.port,process.env.API_HOST??'127.0.0.1');console.log(JSON.stringify({event:'api.ready',port:config.port}));
  const stop=async()=>{await app.close();await db.close();};process.on('SIGTERM',()=>void stop());process.on('SIGINT',()=>void stop());
}).catch(()=>{console.error('API startup failed; verify database and instance configuration.');process.exitCode=1;void db.close();});}
