'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const root='rootfs/etc/';
const html=fs.readFileSync(root+'smartphoton_jkbms_multipack/www/scada/index.html','utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script,'SCADA inline JS exists');
new vm.Script(script,{filename:'scada/index.html'});
const config=fs.readFileSync('config.yaml','utf8');
assert.match(config,/version: 1\.0\.0-dev80\.[12]/);
const flow=JSON.parse(fs.readFileSync(root+'node-red/flows.json','utf8'));
assert.equal(flow.length,449,'preserve all Node-RED nodes');
for(const n of flow)if(typeof n.func==='string')new vm.Script('(function(){'+n.func+'})');
for(const id of ['34cada0000000002','74a0000000000002']){
 const n=flow.find(x=>x.id===id);
 assert.ok(n&&n.func.includes('v=dev80-'+(config.includes('dev80.2')?'2':'1')),'dashboard iframe cache-bust updated: '+id);
}
const engine=fs.readFileSync(root+'node-red/active-polling.js','utf8');
assert.match(engine,/\(\?:dry\|cmd\)/,'engine permits correlated generic request IDs');
assert.doesNotMatch(script,/await h\.callService\('switch',/);
assert.doesNotMatch(script,/await h\.callService\('number','set_value'/);
assert.match(script,/if\(!scadaWritableBms\(p,b\)\)throw new Error/,'DRY checks connectivity before publish');
assert.match(script,/cancelControlCommandConfirm\(\)/,'confirmation closes when unavailable');

const start=script.indexOf('const CONTROL_COMMAND_TIMEOUT_MS=15000;');
const end=script.indexOf('const controlCommandState={};',start);
assert.ok(start>0&&end>start);
const helper=script.slice(start,end);
let pack={id:'pack_2',online:true};
let age=2,enabled=true,listener=null,timeout=null,watch=null;
let published=[],unsubscribeCount=0,engineReply=null;
const hass={
 callService:async(domain,action,payload)=>{
  assert.equal(domain,'mqtt');assert.equal(action,'publish');
  assert.equal(payload.retain,false);assert.equal(payload.qos,0);
  published.push(payload);
  if(engineReply){
   const request=JSON.parse(payload.payload);
   listener({topic:'jkbms/pack_2/BMS_1/active_polling/command_result',
    payload:JSON.stringify({event:'command',pack_id:'pack_2',bms_numero:1,
      control:payload.topic.split('/').at(-2),status:engineReply.status||'confirmed',
      request_id:engineReply.mismatchId?'cmd-different-12345678':request.request_id,
      readback_value:engineReply.readback===undefined?request.value:engineReply.readback,
      error:engineReply.error||null,command_id:'test-c1'})});
  }
 },
 connection:{subscribeMessage:async(fn,filter)=>{
  assert.equal(filter.type,'mqtt/subscribe');
  assert.equal(filter.topic,'jkbms/pack_2/BMS_1/active_polling/command_result');
  listener=fn;
  return ()=>{unsubscribeCount++};
 }}
};
const ctx={
 currentPacks:[pack],
 getHass:()=>enabled?hass:null,
 memberHeartbeatAge:()=>age,
 crypto:{randomUUID:()=> '12345678-1234-4123-9234-123456789012'},
 setTimeout:fn=>{timeout=fn;return 1;},
 clearTimeout:()=>{timeout=null;},
 setInterval:fn=>{watch=fn;return 2;},
 clearInterval:()=>{watch=null;},
 Date,JSON,Number,Promise,Math
};
const api=vm.runInNewContext(helper+'\n({writable:scadaWritableBms,publish:scadaPublishVerifiedCommand})',ctx);

async function main(){
 assert.equal(api.writable('pack_2','1'),true);
 pack.online=false;
 assert.equal(api.writable('pack_2','1'),false);
 await assert.rejects(api.publish('pack_2','1','display_always_on_switch',true),/hors ligne/);
 assert.equal(published.length,0,'no MQTT write while offline');
 pack.online=true;age=28;
 assert.equal(api.writable('pack_2','1'),false);
 await assert.rejects(api.publish('pack_2','1','display_always_on_switch',true),/périmées/);
 age=2;
 engineReply={status:'confirmed'};
 const sw=await api.publish('pack_2','1','display_always_on_switch',true);
 assert.equal(sw.status,'confirmed');
 assert.equal(JSON.parse(published.at(-1).payload).value,true);
 assert.match(JSON.parse(published.at(-1).payload).request_id,/^cmd-/);
 await api.publish('pack_2','1','max_charge_current',120);
 assert.equal(JSON.parse(published.at(-1).payload).value,120);

 engineReply={status:'confirmed',readback:false};
 await assert.rejects(api.publish('pack_2','1','display_always_on_switch',true),/différente/);
 engineReply={status:'rejected',error:'target_live_stale'};
 await assert.rejects(api.publish('pack_2','1','display_always_on_switch',true),/target_live_stale/);
 engineReply={mismatchId:true};
 const missing=api.publish('pack_2','1','display_always_on_switch',true);
 await new Promise(resolve=>setImmediate(resolve));
 assert.ok(timeout,'pending request has timeout');
 timeout();
 await assert.rejects(missing,/état incertain/);
 engineReply=null;
 const dropped=api.publish('pack_2','1','display_always_on_switch',true);
 await new Promise(resolve=>setImmediate(resolve));
 pack.online=false;
 assert.ok(watch,'pending request checks communication');
 watch();
 await assert.rejects(dropped,/Liaison BMS perdue/);
 pack.online=true;

 // The exact production Node-RED function: JSON requests are correlated,
 // while older Home Assistant True/False and numeric payloads remain valid.
 const active=flow.find(n=>n.id==='a47300000000000e');
 const run=new Function('msg','node','global','Buffer',active.func);
 const calls=[],events=[],logs=[];
 let accept=true;
 const ap={start:()=>{},snapshot:()=>[],stop:()=>{},
  command:(...args)=>{calls.push(args);return accept}};
 const node={id:'engine-1',send:m=>events.push(m.payload),
  warn:x=>logs.push(x),error:x=>{throw Error(x)}};
 const gl={get:k=>({
  jkbmsActivePolling:ap,jkbms_active_polling_enabled:true,
  jkbms_pack_defs:{pack_2:{id:'pack_2',transport:'tcp',host:'192.0.2.1',port:5032,bms_addresses:[1]}},
  jkbms_pack_ids:['pack_2'],non_broadcasting_data_interval_s:3
 })[k]};
 const topic='jkbms/pack_2/BMS_1/control/';
 run({topic:topic+'display_always_on_switch/set',payload:'True',retain:false},node,gl,Buffer);
 assert.equal(calls.at(-1)[4],true);
 assert.equal(calls.at(-1)[6]?.request_id,undefined);
 run({topic:topic+'max_charge_current/set',payload:'100.5',retain:false},node,gl,Buffer);
 assert.equal(calls.at(-1)[4],100.5);
 run({topic:topic+'display_always_on_switch/set',
  payload:JSON.stringify({value:false,request_id:'cmd-abcdefgh12345678'}),retain:false},node,gl,Buffer);
 assert.equal(calls.at(-1)[4],false);
 assert.equal(calls.at(-1)[6].request_id,'cmd-abcdefgh12345678');
 run({topic:topic+'max_charge_current/set',
  payload:JSON.stringify({value:110.5,request_id:'cmd-ijklmnop12345678'}),retain:false},node,gl,Buffer);
 assert.equal(calls.at(-1)[4],110.5);
 assert.equal(calls.at(-1)[6].request_id,'cmd-ijklmnop12345678');
 accept=false;
 run({topic:topic+'max_charge_current/set',
  payload:JSON.stringify({value:110.5,request_id:'cmd-refused12345678'}),retain:false},node,gl,Buffer);
 assert.equal(events.at(-1).status,'rejected');
 assert.equal(events.at(-1).request_id,'cmd-refused12345678');
 assert.equal(unsubscribeCount,6,'subscriptions cleaned after all tests');
 console.log('PASS dev80-1-scada-command-correlation.test.cjs');
}
main().catch(e=>{console.error(e);process.exitCode=1});
