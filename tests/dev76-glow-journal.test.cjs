'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const collector=fs.readFileSync(path.join(ROOT,'rootfs/etc/node-red/glow_journal_collector.js'),'utf8');
const flows=JSON.parse(fs.readFileSync(path.join(ROOT,'rootfs/etc/node-red/flows.json'),'utf8'));
const node=flows.find(n=>n.id==='76a0000000000003');
assert.ok(node,'private journal Function missing');
assert.equal(node.func,collector,'Node-RED Function source must equal audited source');
const inputs=flows.filter(n=>n.type==='mqtt in'&&n.wires?.[0]?.includes(node.id));
assert.deepEqual(inputs.map(x=>x.topic).sort(),['jkbms/+/+/alarm/active','jkbms/+/aggregate','jkbms/scada/audit/snapshot']);
assert.equal(node.outputs,1);
assert.deepEqual(node.wires,[[]],'journal collector must not expose data to MQTT or HA');
const state=new Map(),status={};
const global={get:key=>state.get(key),set:(key,value)=>state.set(key,structuredClone(value))};
const executable='(function(){\n'+collector+'\n})()';
let clockMs=Date.now();
class ClockDate extends Date {static now(){return clockMs;}}
const run=(msg)=>vm.runInNewContext(executable,{msg,global,node:{status:x=>{status.current=x}},Buffer,Date:ClockDate,JSON,Number,String,Array,Object,Math,RegExp});
const KEY='jkbms_glow_journal_v1';
const t=Date.now()-120000;
const audit={
 source:'node_red',command_audit:{history:[
  {id:'command123',pack_id:'pack_1',bms:'0',started_at:t,status:'sent',control_label:'Charging MOS'}
 ]},
 alarm_lifecycle:{active:[
  {id:'alarm123',pack_id:'pack_1',code:'CELL_DELTA_HIGH',severity:'ATTENTION',first_seen:t,message:'28 mV'}
 ],history:[]}
};
const publish=x=>run({topic:'jkbms/scada/audit/snapshot',payload:JSON.stringify(x),retain:true});
publish(audit);
let s=state.get(KEY);
assert.equal(s.events.length,2,'audit imports command and active alarm');
assert.ok(s.events.every(x=>typeof x.t==='number' && x.pack==='pack_1'));
publish(audit);
assert.equal(state.get(KEY).events.length,2,'retained audit must be idempotent');
audit.command_audit.history[0].status='confirmed';
publish(audit);
assert.equal(state.get(KEY).events.find(x=>x.id==='command:command123').det,'confirmed');
audit.alarm_lifecycle.history=[{...audit.alarm_lifecycle.active[0],cleared_at:t+60000}];
audit.alarm_lifecycle.active=[];
publish(audit);
s=state.get(KEY);
assert.equal(s.events.length,3);
assert.ok(s.events.some(x=>x.id==='alarm:off:alarm123'));
const hardware=(payload,retain=false)=>run({topic:'jkbms/pack_1/BMS_0/alarm/active',payload,retain});
hardware('OFF',true);
assert.equal(state.get(KEY).events.length,3,'retained OFF is baseline, not event');
hardware('ON');
assert.equal(state.get(KEY).events.length,4);
hardware('ON');
assert.equal(state.get(KEY).events.length,4,'repeated ON not a new alarm');
hardware('OFF');
assert.equal(state.get(KEY).events.length,5);
hardware('ON',true);
assert.equal(state.get(KEY).events.length,5,'retained ON must not fabricate transition');
run({topic:'irrelevant/topic',payload:'bad'});
assert.equal(state.get(KEY).events.length,5);
const many=Array.from({length:280},(_,i)=>({id:'m'+i,pack_id:'pack_1',bms:'0',status:'confirmed',started_at:t+i*10,control_label:'test'}));
for(let i=0;i<280;i+=60)publish({source:'node_red',command_audit:{history:many.slice(i,i+60)},alarm_lifecycle:{active:[],history:[]}});
assert.ok(state.get(KEY).events.length<=250,'retention bound');
// Retained aggregate only establishes baselines. Transient current noise must not log.
const aggregate=(current,balancing,retained=false)=>run({
 topic:'jkbms/pack_1/aggregate',retain:retained,
 payload:JSON.stringify({step:'13E',pack_id:'pack_1',current_total_a:current,
  balancing_details:[{bms:'0',active:balancing}]})
});
let baseline=state.get(KEY).events.length;
aggregate(0,false,true);
assert.equal(state.get(KEY).events.length,baseline);
clockMs+=1000;aggregate(7,true);
clockMs+=1000;aggregate(0,false);
assert.equal(state.get(KEY).events.length,baseline,'short transient should not be recorded');
clockMs+=1000;aggregate(7,true);
clockMs+=9000;aggregate(7,true);
assert.equal(state.get(KEY).events.length,baseline,'debounce requires full 10 seconds');
clockMs+=1500;aggregate(7,true);
assert.equal(state.get(KEY).events.length,baseline+2,'balancing and charging transitions should be logged once each');
aggregate(7,true);
assert.equal(state.get(KEY).events.length,baseline+2,'steady aggregate must not produce duplicate events');
clockMs+=1000;aggregate(-8,false);
clockMs+=11000;aggregate(-8,false);
assert.equal(state.get(KEY).events.length,baseline+4,'charge to discharge and balancing stop transitions logged');
assert.equal(state.get(KEY).events.filter(x=>x.cat==='bal').length,2);
assert.equal(state.get(KEY).events.filter(x=>x.cat==='flow').length,2);
assert.ok(!JSON.stringify(state.get(KEY)).includes('password'));
console.log('PASS dev76-glow-journal.test.cjs');
