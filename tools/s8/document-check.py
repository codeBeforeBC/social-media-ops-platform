"""Check the single task ledger, dependency graph and current S8 evidence links."""
from pathlib import Path
from collections import Counter
import re
progress=Path('docs/tracking/开发进度.md').read_text()
rows=[line.split('|')[1:-1] for line in progress.splitlines() if re.match(r'\| S\d+-\d+ \|',line)]
tasks={row[0].strip():row for row in rows}
assert len(tasks)==len(rows)==69
counts=Counter(row[4].strip() for row in rows)
labels={'DONE':'已完成','DOING':'进行中','VERIFY':'待验证','BLOCKED':'阻塞','TODO':'待开始','CANCELLED':'取消'}
first=progress.split('## 状态与更新规则')[0]
for state,label in labels.items():
 assert int(re.search(label+r' \*\*(\d+)\*\*',first).group(1))==counts[state],state
for n in range(1,7):assert tasks[f'S8-{n:02d}'][4].strip()=='DONE'

for task,row in tasks.items():
 for dep in re.findall(r'S\d+-\d+',row[3]):
  assert dep in tasks,(task,dep)
  if row[4].strip()=='DONE':assert tasks[dep][4].strip()=='DONE',(task,dep)
  assert row[4].strip()=='CANCELLED' or tasks[dep][4].strip()!='CANCELLED',(task,dep)
def visit(task,stack):
 assert task not in stack,(task,stack)
 for dep in re.findall(r'S\d+-\d+',tasks[task][3]):visit(dep,stack+[task])
for task in tasks:visit(task,[])
links=0
for path in [Path('docs/tracking/开发进度.md'),Path('docs/tracking/开发日志.md'),Path('docs/evidence/s8/README.md')]:
 for link in re.findall(r'\]\(([^)]+)\)',path.read_text()):
  if link.startswith(('http','app:','#','codex:')):continue
  target=link.split('#')[0]
  assert (path.parent/target).exists(),(path,link)
  links+=1
print({'tasks':len(tasks),'counts':dict(counts),'dependencies':'passed','links':links})
