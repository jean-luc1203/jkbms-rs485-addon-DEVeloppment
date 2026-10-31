'use strict';
// DEV74.3: no Home Assistant/MQTT/serial access; all checks are local mocks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const base=path.join(__dirname,'..');
const flows=JSON.parse(fs.readFileSync(path.join(base,'rootfs/etc/node-red/flows.json'),'utf8'));
const config=fs.readFileSync(path.join(base,'config.yaml'),'utf8');
const sync=fs.readFileSync(path.join(base,'rootfs/etc/node-red/dashboard_sync.js'),'utf8');
assert.match(config,/version: 1\.0\.0-dev74\.3/);
assert.equal(flows.length,445,'Unexpected Node-RED node count');
assert.equal(flows.filter(n=>n.type==='function').length,104,'Unexpected Node-RED function count');
const get=id=>{const n=flows.find(x=>x.id===id);assert(n&&n.type==='function',id+' missing');new vm.Script('(function(msg){'+n.func+'})',{filename:n.name});return n.func};
const premium=get('13b6b22d1a8e5d02');
const scada=get('34cada0000000002');
const glow=get('74a0000000000002');
const bridge=get('13b6b22d1a8e5c40');
const audit=get('59a1a00000000002');

function execute(source,values={}){
 const sandbox={
   msg:{},global:{get:(key)=>values[key]},
   node:{status:()=>{},warn:()=>{},log:()=>{}},
   flow:{get:()=>null,set:()=>{}},Buffer,
 };
 return vm.runInNewContext('(function(){'+source+'})()',sandbox,{timeout:10000});
}
const entitlement={
 'premium.runtime_mode':'multi_pack',
 'premium.multi_pack_premium_available':true,
 'premium.features':{dashboard_premium:true},
};
for(const [code,title,url] of [
 [scada,'JK-BMS SCADA','smart-jkbms-scada'],
 [glow,'JK-BMS MultiPack','smart-jkbms-glow']
]){
 const [msg,deleteMsg]=execute(code,entitlement);
 assert(msg && !deleteMsg,'Premium registration missing for '+title);
 const payload=JSON.parse(msg.payload);
 assert.equal(payload.dashboard_meta.title,title);
 assert.equal(payload.config.views[0].title,title);
 assert.equal(payload.dashboard_meta.url_path,url,'Dashboard URL must not change');
 const denied=execute(code,{'premium.runtime_mode':'legacy','premium.features':{dashboard_premium:true}});
 assert.equal(denied[0],null,'Premium gate bypassed');
}
const defs={pack_1:{name:'Pack 1'},pack_2:{name:'Pack 2'}};
const result=execute(premium,{
 ...entitlement,'jkbms_pack_ids':['pack_1','pack_2'],
 'jkbms_pack_defs':defs,'config.dashboardLanguage':'fr',
 'config.dashboardCustomCardsInstalled':false
});
const meta=JSON.parse(result[0].payload);
assert.equal(meta.dashboard_meta.title,'JK-BMS Diagnostics');
assert.equal(meta.dashboard_meta.url_path,'smart-jkbms-multipack');
const views=meta.config.views;
assert.deepEqual(Array.from(views.slice(0,2),v=>v.path),['diagnostics','aggregation']);
assert(views.slice(2).every(v=>v.subview===true),'Only Diagnostics and Aggregation can be top-level tabs');
assert(!views.some(v=>v.path==='overview'),'Obsolete Packs overview should not be registered');
assert(views.some(v=>v.path==='pack-1'),'Existing pack detail deep links must remain');
assert(views.some(v=>v.path.includes('bms-')),'BMS deep links must remain');
const diagnostics=JSON.stringify(views[0]);
assert(diagnostics.includes("t.get('cell_delta_high_v') is number"),'Missing truthful threshold guard');
assert(diagnostics.includes("t.get('temperature_high_c') is number"),'Missing temperature threshold guard');
assert(!diagnostics.includes("t.get('cell_delta_high_v', 0)"),'Must not invent a zero threshold');

function extractFunction(code,name){
 const start=code.indexOf('function '+name+'(');
 assert(start>=0,'Missing '+name);
 const end=code.indexOf('\n}',start);
 assert(end>start,name+' not terminated');
 return code.slice(start,end+2);
}
const diagInput={
 status:'CELL_DELTA_HIGH',thresholds:{cell_delta_high_v:0.05,temperature_high_c:50},
 active_issues:[{code:'CELL_DELTA_HIGH',pack_id:'pack_1',value_mv:57}]
};
const bridgeFn=extractFunction(bridge,'sanitizeDiagnostic');
const sanitized=vm.runInNewContext('(function(){'+bridgeFn+';return sanitizeDiagnostic(input)})()',{
 input:diagInput,global:{get:()=>({history:[]})}
});
assert.equal(sanitized.thresholds.cell_delta_high_v,0.05);
assert.equal(sanitized.thresholds.temperature_high_c,50);
assert.equal(sanitized.active_issues[0].value_mv,57);
const mirrorFn=extractFunction(audit,'compactDiagnostic');
const mirrored=vm.runInNewContext('(function(){'+mirrorFn+';return compactDiagnostic(input,snap)})()',{
 input:diagInput,snap:{alarm_history_count:0,alarm_active_count:0,command_count:0,generated_at:'test'},
 shortText:(x,max)=>x==null?null:String(x).slice(0,max),
 COMMAND_MAX:240, DETAIL_TOPIC:'jkbms/scada/audit/snapshot'
});
assert.deepEqual(JSON.parse(JSON.stringify(mirrored.thresholds)),diagInput.thresholds);
assert.equal(mirrored.active_issues[0].code,'CELL_DELTA_HIGH');
assert(sync.includes('lovelace/dashboards/update'),'Sidebar title must be updated in existing HA registration');
console.log('PASS: DEV74.3 sidebar titles, diagnostics-first tabs, preserved pack/BMS links, truthful HA diagnostic thresholds/issues');
