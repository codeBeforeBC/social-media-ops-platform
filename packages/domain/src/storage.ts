import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {S3Client,HeadBucketCommand,CreateBucketCommand,PutBucketCorsCommand,CreateMultipartUploadCommand,UploadPartCommand,CompleteMultipartUploadCommand,AbortMultipartUploadCommand,GetObjectCommand,HeadObjectCommand,DeleteObjectCommand,PutObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {config} from './config';
import {AppError} from './protocol';
export class Storage {
 readonly client:S3Client;readonly publicClient:S3Client;
 readonly bucket=process.env.S3_BUCKET??'yoyo-private';
 constructor(){
  const c=JSON.parse(readFileSync(resolve(config.stateDir,'instance.json'),'utf8'));
  const credentials={accessKeyId:process.env.S3_ACCESS_KEY??c.storage_access_key,secretAccessKey:process.env.S3_SECRET_KEY??c.storage_secret_key};
  if(!credentials.accessKeyId||!credentials.secretAccessKey)throw new Error('Initialize storage credentials first');
  const options={credentials,region:process.env.S3_REGION??'us-east-1',forcePathStyle:true,requestChecksumCalculation:'WHEN_REQUIRED' as const,responseChecksumValidation:'WHEN_REQUIRED' as const};
  this.client=new S3Client({...options,endpoint:process.env.S3_ENDPOINT??'http://127.0.0.1:59000'});
  this.publicClient=new S3Client({...options,endpoint:process.env.S3_PUBLIC_ENDPOINT??process.env.S3_ENDPOINT??'http://127.0.0.1:59000'});
 }
 async init(){
  try{await this.client.send(new HeadBucketCommand({Bucket:this.bucket}));}
  catch(e){if((e as any).$metadata?.httpStatusCode!==404)throw e;await this.client.send(new CreateBucketCommand({Bucket:this.bucket}));}
  await this.client.send(new PutBucketCorsCommand({Bucket:this.bucket,CORSConfiguration:{CORSRules:[{AllowedOrigins:[config.origin],AllowedMethods:['GET','HEAD'],AllowedHeaders:['*'],ExposeHeaders:['Content-Length','Content-Range','ETag']}]}}));
 }
 async create(key:string){return (await this.client.send(new CreateMultipartUploadCommand({Bucket:this.bucket,Key:key,ContentType:'application/octet-stream'}))).UploadId!;}
 async part(key:string,uploadId:string,n:number,body:Buffer){return (await this.client.send(new UploadPartCommand({Bucket:this.bucket,Key:key,UploadId:uploadId,PartNumber:n,Body:body}))).ETag!;}
 async complete(key:string,uploadId:string,parts:{part_number:number;etag:string}[]){
  try{await this.client.send(new CompleteMultipartUploadCommand({Bucket:this.bucket,Key:key,UploadId:uploadId,MultipartUpload:{Parts:parts.map(p=>({PartNumber:p.part_number,ETag:p.etag}))}}));}
  catch(e){if((e as any).name!=='NoSuchUpload')throw e;await this.client.send(new HeadObjectCommand({Bucket:this.bucket,Key:key}));}
 }
 async abort(key:string,uploadId:string){try{await this.client.send(new AbortMultipartUploadCommand({Bucket:this.bucket,Key:key,UploadId:uploadId}));}catch(e){if((e as any).name!=='NoSuchUpload')throw e;}}
 async get(key:string){return this.client.send(new GetObjectCommand({Bucket:this.bucket,Key:key}));}
 async putStream(key:string,stream:AsyncIterable<Uint8Array>,mime:string){
  const uploadId=await this.create(key);let pending=Buffer.alloc(0),size=0;const digest=(await import('node:crypto')).createHash('sha256');const parts:{part_number:number;etag:string}[]=[];
  try{for await(const chunk of stream){size+=chunk.length;if(size>2147483648)throw new Error('PREVIEW_TOO_LARGE');digest.update(chunk);pending=Buffer.concat([pending,chunk]);while(pending.length>=8388608){const part=pending.subarray(0,8388608);pending=pending.subarray(8388608);const n=parts.length+1;parts.push({part_number:n,etag:await this.part(key,uploadId,n,part)});}}if(pending.length){const n=parts.length+1;parts.push({part_number:n,etag:await this.part(key,uploadId,n,pending)});}if(!parts.length)throw new Error('EMPTY_PREVIEW');await this.complete(key,uploadId,parts);return {size_bytes:size,sha256:digest.digest('hex')};}
  catch(e){await this.abort(key,uploadId);throw e;}
 }
 async remove(key:string){await this.client.send(new DeleteObjectCommand({Bucket:this.bucket,Key:key}));}
 async put(key:string,body:Buffer,mime:string){await this.client.send(new PutObjectCommand({Bucket:this.bucket,Key:key,Body:body,ContentType:mime}));}
 async signed(key:string,name:string,mime:string,inline=false){
  const disposition=`${inline?'inline':'attachment'}; filename="download"; filename*=UTF-8''${encodeURIComponent(name)}`;
  const url=await getSignedUrl(this.publicClient,new GetObjectCommand({Bucket:this.bucket,Key:key,ResponseContentDisposition:disposition,ResponseContentType:mime}),{expiresIn:300});
  return {url,expires_at:new Date(Date.now()+300000).toISOString()};
 }
 destroy(){this.client.destroy();this.publicClient.destroy();}
}
export function storageError(e:unknown):never{if(e instanceof AppError)throw e;throw new AppError(503,'STORAGE_UNAVAILABLE','文件存储暂时不可用，请重试',{},true);}
