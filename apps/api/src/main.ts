import 'reflect-metadata';
import {All,Controller,Module,Req,Res,Inject,Catch,ExceptionFilter,ArgumentsHost,HttpException} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {NestExpressApplication} from '@nestjs/platform-express';
import {Request,Response,NextFunction} from 'express';
import cookieParser from 'cookie-parser';
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
  private readonly auth:Auth;private readonly commands:Commands;
  constructor(@Inject(DB) readonly db:Database){this.auth=new Auth(db);this.commands=new Commands(db);}
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
    // S1只提供文件权限守卫。S2接入真实文件/签名后扩展该路由，当前不返回伪下载地址。
    const file=path.match(/^\/files\/([^/]+)\/(download|preview)$/);
    if(file&&method==='GET'){parse(uuid,file[1]);if(file[2]==='download')authorize(a,'download.original');throw new AppError(404,'NOT_FOUND','文件不存在或不可见');}
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
  app.use(helmet({contentSecurityPolicy:{directives:{upgradeInsecureRequests:config.secure?[]:null}}}));
  app.use(cookieParser());app.useGlobalFilters(new ApiErrors());
  app.useStaticAssets(resolve('apps/web/dist'),{index:'index.html'});
  await app.init();return app;
}
if(require.main===module){const db=new Database();createApp(db).then(async app=>{
  await app.listen(config.port,process.env.API_HOST??'127.0.0.1');console.log(JSON.stringify({event:'api.ready',port:config.port}));
  const stop=async()=>{await app.close();await db.close();};process.on('SIGTERM',()=>void stop());process.on('SIGINT',()=>void stop());
}).catch(()=>{console.error('API startup failed; verify database and instance configuration.');process.exitCode=1;void db.close();});}
