import subprocess,json,pathlib,hashlib,time
pathlib.Path('.local/s11-backups').mkdir(mode=0o700,parents=True,exist_ok=True)
out=[]
containers=['yoyo-dev-db-1','yoyo-s1-smoke-db-1','yoyo-s2-smoke-db-1','yoyo-s3-ai-smoke-db-1','yoyo-db-1']
for original in containers:
 running=subprocess.check_output(['docker','inspect','-f','{{.State.Running}}',original],text=True).strip()=='true'
 name=original
 if original=='yoyo-db-1' and not running:
  name='yoyo-s11-inventory-db'
  subprocess.run(['docker','run','-d','--name',name,'--volumes-from',original,subprocess.check_output(['docker','inspect','-f','{{.Config.Image}}',original],text=True).strip()],check=True,stdout=subprocess.DEVNULL)
 elif not running:subprocess.run(['docker','start',name],check=True,stdout=subprocess.DEVNULL)
 try:
  for i in range(60):
   if subprocess.run(['docker','exec',name,'pg_isready','-U','yoyo'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:break
   time.sleep(.2)
  databases=subprocess.check_output(['docker','exec',name,'psql','-U','yoyo','-d','postgres','-Atc',"SELECT datname FROM pg_database WHERE NOT datistemplate AND datname<>'postgres'"],text=True).splitlines()
  for database in databases:
   path=pathlib.Path('.local/s11-backups')/(original+'-'+database+'.dump')
   with path.open('xb') as f:subprocess.run(['docker','exec',name,'pg_dump','-U','yoyo','-d',database,'-Fc'],stdout=f,check=True)
   path.chmod(0o600)
   tables=subprocess.check_output(['docker','exec',name,'psql','-U','yoyo','-d',database,'-Atc',"SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"],text=True).splitlines()
   counts={t:int(subprocess.check_output(['docker','exec',name,'psql','-U','yoyo','-d',database,'-Atc',f'SELECT count(*) FROM "{t}"'],text=True).strip()) for t in tables}
   jobs=[]
   if 'jobs' in tables:jobs=subprocess.check_output(['docker','exec',name,'psql','-U','yoyo','-d',database,'-Atc','SELECT type,pool,state,count(*) FROM jobs GROUP BY type,pool,state ORDER BY 1,2,3'],text=True).splitlines()
   out.append({'container':original,'database':database,'counts':counts,'jobs':jobs,'backup_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'backup_bytes':path.stat().st_size,'was_running':running})
   pathlib.Path('docs/evidence/s11/inventory.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
 finally:
  if name!=original:subprocess.run(['docker','stop',name],check=True,stdout=subprocess.DEVNULL);subprocess.run(['docker','rm',name],check=True,stdout=subprocess.DEVNULL)
  elif not running:subprocess.run(['docker','stop',name],check=True,stdout=subprocess.DEVNULL)
assert {x['container'] for x in out}==set(containers)
print(json.dumps([{'instance':x['container']+'/'+x['database'],'tables':len(x['counts']),'nonempty':{k:v for k,v in x['counts'].items() if v},'jobs':x['jobs']} for x in out],ensure_ascii=False))
