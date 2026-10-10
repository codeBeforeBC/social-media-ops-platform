import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
const require=createRequire(resolve(process.env.ARTIFACT_MODULES??'.local/s7-artifact/node_modules','../package.json'));
const {Workbook,SpreadsheetFile}=await import(pathToFileURL(require.resolve('@oai/artifact-tool')).href);
const {fields,definitions}=JSON.parse(execFileSync('pnpm',['exec','tsx','tools/s7/export-schema.ts'],{encoding:'utf8'}));
const headers=Object.keys(fields),example={account_id:'EXAMPLE_NOT_BOOKABLE',metric_key:'followers',value:631,unit:'人',observed_at:'2026-10-01T00:00:00+08:00',traffic_type:'unknown',source_note:'示例，永久不可入账。实际数据另建行',definition_version:'1',aggregation_kind:'snapshot',source_definition:'示例粉丝总数',time_precision:'day',is_example:'true'};
const rows=[headers,headers.map(k=>example[k]??'')];
const workbook=Workbook.create();const data=workbook.worksheets.add('导入数据');data.showGridLines=false;data.getRange('F1:H2').setNumberFormat('@');data.getRange('A1:P2').values=rows;data.getRange('H2').values=[['示例时间：'+example.observed_at]];data.getRange('F3:H5001').setNumberFormat('@');data.getRange('A1:P2').format.font={name:'Arial',size:10};data.getRange('A1:P1').format={fill:'#243B53',font:{bold:true,color:'#FFFFFF'},rowHeight:28};data.getRange('A2:P2').format={fill:'#FFF4CF',rowHeight:44};data.getRange('A1:P2').format.columnWidth=25;data.getRange('J1:J2').format.columnWidth=50;data.getRange('A1:P2').format.wrapText=true;data.getRange('D2').setNumberFormat('#,##0');data.freezePanes.freezeRows(1);
const notes=workbook.worksheets.add('字段说明');notes.showGridLines=false;const guide=[['字段','中文说明'],...Object.entries(fields),['格式版本','table-v1；第一张表为导入数据，字段说明不入账'],['日期','带时区ISO8601文本用于接口；时间粒度必须保留'],['样例','is_example=true 永久排除。实际数据新建行填写false'],['指标','以下字典为程序口径，真实平台定义需要人工核验'],...definitions.map(d=>[d.key,`${d.label}；${d.unit}；${d.scope}；${d.kinds.join('/')}`])];notes.getRange(`A1:B${guide.length}`).values=guide;notes.getRange(`A1:B${guide.length}`).format.font={name:'Arial',size:10};notes.getRange('A1:B1').format={fill:'#243B53',font:{bold:true,color:'#FFFFFF'}};notes.getRange(`A1:A${guide.length}`).format.columnWidth=32;notes.getRange(`B1:B${guide.length}`).format.columnWidth=82;notes.getRange(`A1:B${guide.length}`).format.rowHeight=24;
workbook.recalculate();assert.equal(data.getRange('P2').values[0][0],'true');assert.equal(data.getRange('D2').values[0][0],631);
for(const [sheetName,range,name] of [['导入数据','A1:P2','template-data'],['字段说明',`A1:B${guide.length}`,'template-fields']]){const preview=await workbook.render({sheetName,range,scale:1,format:'png'});await fs.writeFile(`docs/evidence/s7/${name}.png`,new Uint8Array(await preview.arrayBuffer()));}
const output=await SpreadsheetFile.exportXlsx(workbook);await output.save('docs/templates/yoyo-import-v1.xlsx');
await fs.writeFile('docs/templates/yoyo-import-v1.csv','\ufeff'+rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n');
await fs.writeFile('docs/templates/S7-字段说明.md','# S7 表格导入字段说明\n\n版本table-v1。第一张工作表为数据，字段说明不导入。示例行`is_example=true`永久不可确认；实际数据新建行填false。原值、实际时间粒度与平台定义必须核对。\n\n| 字段 | 说明 |\n|---|---|\n'+Object.entries(fields).map(([k,v])=>`| ${k} | ${v} |`).join('\n')+'\n');
console.log('CSV/XLSX templates exported; assertions and both renders passed');
