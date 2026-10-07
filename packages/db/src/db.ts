import pg from 'pg';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {databaseUrl} from '../../domain/src/config';
export type Tx=pg.PoolClient;
export class Database {
  readonly pool:pg.Pool;readonly prisma:PrismaClient;
  constructor(url=databaseUrl()){
    this.pool=new pg.Pool({connectionString:url,max:10,connectionTimeoutMillis:5000,statement_timeout:15000});
    this.prisma=new PrismaClient({adapter:new PrismaPg({connectionString:url,max:4,connectionTimeoutMillis:5000})});
  }
  query(text:string,values:unknown[]=[]){return this.pool.query(text,values);}
  async transaction<T>(fn:(tx:Tx)=>Promise<T>):Promise<T>{
    const tx=await this.pool.connect();
    try{await tx.query('BEGIN');const value=await fn(tx);await tx.query('COMMIT');return value;}
    catch(e){await tx.query('ROLLBACK');throw e;}
    finally{tx.release();}
  }
  async close(){await this.prisma.$disconnect();await this.pool.end();}
}
