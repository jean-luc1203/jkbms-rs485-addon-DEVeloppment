'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const config=fs.readFileSync('config.yaml','utf8');
assert.match(config,/^version: 1\.0\.0-dev81\.0$/m);
const html=fs.readFileSync('rootfs/etc/smartphoton_jkbms_multipack/www/scada/index.html','utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script,'SCADA JS missing');
new vm.Script(script,{filename:'scada-dev81.0.js'});
const flows=JSON.parse(fs.readFileSync('rootfs/etc/node-red/flows.json','utf8'));
assert.equal(flows.length,449);
for(const node of flows)if(typeof node.func==='string')new vm.Script('(function(){'+node.func+'})');
for(const id of ['34cada0000000002','74a0000000000002']){
 const node=flows.find(n=>n.id===id);
 assert.ok(node&&node.func.includes('v=dev81-0'),'iframe cache marker '+id);
}
const engine=flows.find(n=>n.id==='a47300000000000e');
assert.match(engine.func,/jkbms_active_polling_enabled"\) !== true/,'no Active Polling engine in Broadcasting');

let online=true,age=2,mode='broadcasting';
const liveHass={
 callService:async()=>{throw Error('should never write in Broadcasting')},
 states:{'switch.pack_1_bms_master_charging_switch_active_polling':{state:'on'}}
};
const pack={id:'pack_1',online:true};
const start=script.indexOf('const SCADA_COMMAND_MAX_HEARTBEAT_SEC=20;');
const end=script.indexOf('function scadaCommandRequestId(){',start);
assert.ok(start>0&&end>start,'read/write authorization functions');
const makeGuard=(m)=>vm.runInNewContext(script.slice(start,end)+
 '\n({fresh:scadaTelemetryFresh,writable:scadaWritableBms})',{
  COMM_MODE:m,currentPacks:[pack],getHass:()=>liveHass,
  memberHeartbeatAge:()=>age,Number
 });
let guard=makeGuard('broadcasting');
assert.equal(guard.fresh('pack_1','master'),true,'recent Broadcasting LIVE is readable');
assert.equal(guard.writable('pack_1','master'),false,'recent LIVE cannot authorize writing while Broadcasting');
age=31;
assert.equal(guard.fresh('pack_1','master'),false,'stale Broadcasting telemetry hidden');
age=2;guard=makeGuard('active_polling');
assert.equal(guard.writable('pack_1','master'),true,'Active Polling control retains original gate');
pack.online=false;
assert.equal(guard.writable('pack_1','master'),false,'offline Active Polling cannot write');
pack.online=true;

const cs=script.slice(script.indexOf('function readControlState(packId,bms,def,b){'),script.indexOf('const SCADA_WRITABLE_CONTROL_KEYS='));
assert.ok(cs.startsWith('function readControlState'));
function control(mode,def,b){
 return vm.runInNewContext(cs+'\nreadControlState',{COMM_MODE:mode,
  getHass:()=>liveHass,controlEntityCandidates:()=>['switch.pack_1_bms_master_charging_switch_active_polling'],
  controlBool:x=>x==='on',spParamUi:()=>'-'})('pack_1','master',def,b);
}
const def={key:'charging_switch',fallback:'charge'};
const passive=control('broadcasting',def,{charge:false});
assert.equal(passive.available,true,'live MOS fallback retained');
assert.equal(passive.on,false,'old retained HA ON cannot override broadcasting physical OFF');
assert.equal(passive.entity,null,'broadcasting source must not be Active Polling entity');
assert.equal(control('broadcasting',{key:'lcd'},{}).available,false,'unsupported SETUP state not fabricated');
assert.equal(control('active_polling',def,{charge:false}).on,true,'AP switch preserved');

const num=script.slice(script.indexOf('function readParameterState(packId,bms,def,writable=true){'),
 script.indexOf('function parameterDecimals('));
assert.ok(num.startsWith('function readParameterState'));
const passiveNum=vm.runInNewContext(num+'\nreadParameterState',{COMM_MODE:'broadcasting',
 getHass:()=>liveHass,parameterEntityCandidates:()=>[],parameterNumber:Number,spParamUi:()=>'-'});
assert.equal(passiveNum('pack_1','master',{key:'max_charge_current',unit:'A'},true).available,false);
assert.match(script,/const viewFresh=scadaTelemetryFresh\(packId,bms\)/,'Broadcasting LIVE remains colored/readable');
assert.match(script,/return COMM_MODE==='active_polling'/,'command interlock requires AP mode');

function scan(nodeName,registry,active=false){
 const source=flows.find(n=>n.name===nodeName).func;
 const i=source.indexOf('function getMembersForPack(packId) {'),j=source.indexOf('\nif (!multiPack)',i);
 assert.ok(i>=0&&j>i);
 const segment=source.slice(i,j);
 const normal=values=>[...new Set((values||[]).map(Number).filter(v=>Number.isInteger(v)&&v>=0&&v<=15))].sort((a,b)=>a-b);
 return vm.runInNewContext(segment+'\n({members:getMembersForPack,format:formatMembers})',{
  flow:{get:()=>registry},global:{get:k=>k==='jkbms_pack_defs'?{pack_1:{bms_addresses:[0,2]}}:null},
  activePolling:active,sanitizeIds:normal,Date,Number,Object,Array,Set
 });
}
const now=Date.now();
for(const nodeName of ['Init flags for discovery','Reset discovery flags (auto nb_jkbms)']){
 const stale=scan(nodeName,{ids:[0,1,2],seen:{0:now-500000,1:now-500000,2:now-500000},window_ms:120000});
 const missing=stale.members('pack_1');
 assert.equal(missing.ids.length,0,'old persistent ids must not count as fresh');
 assert.equal(missing.masterDetected,false);
 assert.match(stale.format(missing),/pending/,'no phantom master in discovery text');
 const fresh=scan(nodeName,{ids:[0,1,2],seen:{0:now-2500,2:now-2200,1:now-700000},window_ms:120000});
 const m=fresh.members('pack_1');
 assert.deepEqual(Array.from(m.ids),[2],'only real recent BMS 2 with master counted');
 assert.equal(m.masterDetected,true);
 assert.equal(fresh.format(m),'2 BMS detected: master, 2');
 const noMaster=scan(nodeName,{ids:[0,1,2],seen:{1:now-1500,2:now-1000},window_ms:120000});
 assert.equal(noMaster.format(noMaster.members('pack_1')),'2 BMS detected: 1, 2');
 const ap=scan(nodeName,{seen:{},ids:[]},true);
 assert.deepEqual(Array.from(ap.members('pack_1').ids),[0,2],'manual Active Polling unchanged');
}
console.log('PASS dev81-0-broadcast-readonly-discovery.test.cjs');
