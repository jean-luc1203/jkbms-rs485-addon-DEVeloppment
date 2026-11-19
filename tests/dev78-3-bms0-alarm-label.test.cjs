'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const flows = JSON.parse(fs.readFileSync('rootfs/etc/node-red/flows.json', 'utf8'));
const fn = flows.find(n => n.id === '13aa6803c4d31c36');
assert.ok(fn && fn.type === 'function', 'global alarm aggregator missing');
function run(modeBroadcasting, alarm0, previousState = null) {
  const records = new Map();
  const messages = [];
  const warnings = [];
  const registry = {seen:{'0':Date.now(),'2':Date.now()},ids:[0,2]};
  records.set('broadcast_bms_registry_pack_1', registry);
  records.set('lastGlobalAlarmState_pack_1', previousState);
  records.set('bms_alarm_state_pack_1_2', {has_alarm:false,last_seen:Date.now()});
  const global = {get(key){
    return {'multi_pack_enabled':true,'bms_broadcasting':modeBroadcasting,'nb_jkbms':2}[key];
  }};
  const flow = {
    get(key){return records.get(key);},
    set(key,value){records.set(key,value);}
  };
  const node = {warn(s){warnings.push(String(s));},debug(){}};
  const msg = {
    pack_id:'pack_1',pack_name:'Pack 1 - RS485-1',bus_id:'serial_1',
    alarms:{bms_id:0,has_alarms:alarm0,alarm_count:alarm0?1:0}
  };
  const context=vm.createContext({msg,flow,global,node,Date,Number,Object,String,Math});
  const out=vm.runInContext('(function(){\n'+fn.func+'\n})()',context);
  messages.push(...out[0]);
  const state=messages.find(m=>m.topic==='jkbms/pack_1/BMS_GLOBAL/alarm/state');
  const discovery=messages.find(m=>m.topic.endsWith('/alarm_active/config'));
  return {warnings,registry:records.get('broadcast_bms_registry_pack_1'),state,discovery};
}
const active=run(false,true);
assert.equal(active.state.payload,'ON');
assert.ok(active.warnings.some(w=>w.includes('members=0,2')));
assert.ok(!active.warnings.join(' ').includes('master'));
assert.equal(active.registry.labels.join(','),'0,2');
const activeTransition=run(false,true,'OFF');
assert.ok(activeTransition.warnings.some(w=>w.includes('BMS_0')));
assert.ok(!activeTransition.warnings.join(' ').includes('master'));
const broadcast=run(true,true);
assert.equal(broadcast.state.payload,'ON');
assert.ok(broadcast.warnings.some(w=>w.includes('members=master,2')));
assert.equal(broadcast.registry.labels.join(','),'master,2');
const broadcastTransition=run(true,true,'OFF');
assert.ok(broadcastTransition.warnings.some(w=>w.includes('BMS_master')));
assert.equal(active.discovery.payload.unique_id,broadcast.discovery.payload.unique_id);
assert.equal(active.discovery.payload.state_topic,broadcast.discovery.payload.state_topic);
assert.equal(active.state.topic,broadcast.state.topic);
console.log('PASS dev78-3-bms0-alarm-label.test.cjs');
