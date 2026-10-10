"""Restore restricted object/state archives without touching the original Docker volumes."""
from pathlib import Path
import tarfile,hashlib,json,datetime
root=Path('.local/s11-backups');restore=Path('.local/s11-object-restore');restore.mkdir(mode=0o700,exist_ok=True)
objects=[];states=[]
for archive in sorted(root.glob('*.tar')):
    if archive.name=='yoyo_state.tar':continue # Empty unrelated volume; original default/dev share the bind state backup.
    dest=restore/archive.stem;dest.mkdir(mode=0o700,exist_ok=True)
    with tarfile.open(archive) as tar:
        tar.extractall(dest,filter='data');files=[m for m in tar if m.isfile()];assert files,archive.name
        digest=hashlib.sha256()
        for member in sorted(files,key=lambda m:m.name):
            with tar.extractfile(member) as source:a=hashlib.file_digest(source,'sha256').hexdigest()
            with (dest/member.name).open('rb') as source:assert hashlib.file_digest(source,'sha256').hexdigest()==a
            digest.update((member.name+':'+a+'\n').encode())
        record={'archive':archive.name,'restored_files':len(files),'restored_bytes':sum(m.size for m in files),'all_entries_sha256_match':True,'manifest_hash':digest.hexdigest()}
        (objects if archive.stem.endswith('_objects') else states).append(record)
assert len(objects)==4 and len(states)==5
Path('docs/evidence/s11/object-restore-verification.json').write_text(json.dumps({'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'original object/state archives restored into private local directories; no original volume deleted or changed; no object garbage collection','objects':objects,'instance_state':states},indent=2)+'\n')
print('OBJECT_STATE_RESTORE_PASSED',len(objects),len(states))
