'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {performance}=require('node:perf_hooks');
const ap=require('../rootfs/etc/node-red/active-polling.js');
const {Engine}=ap;
const html=fs.readFileSync('rootfs/etc/smartphoton_jkbms_multipack/www/scada/index.html','utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script,'Missing SCADA JS');
new vm.Script(script,{filename:'scada/index.html'});

// Test the actual Engine prototype: avoid constructing real serial/TCP buses.
// The fake bus never touches hardware; writes are recorded only after beforeSend.
function rig(){
 const events=[],writes=[],engine=Object.create(Engine.prototype);
 engine.emit=e=>events.push(e);
 engine.authorized=()=>true;
 engine.stopped=false;
 engine.timeoutMs=1000;
 engine.intervalMs=3000;
 engine.commandFreshnessMs=9500;
 engine.serialInterFrameMs=100;
 engine.states=new Map();
 engine.frameMeta=new WeakMap();
 engine.wake=()=>{};
 engine.publish=()=>{};
 const state={
  def:{id:'pack_2',name:'Berlin',transport:'tcp',bus_id:'TCP2',bms_addresses:[0,1,2]},
  bus:{ready:true},due:[{addr:1,reg:0x1620,at:performance.now()+120000}],commands:[],running:false,autoDiscovery:false,
  discoveryComplete:true,discoveryRetryAt:performance.now()+1000,
  transportEpoch:1,lastLive:{0:Date.now(),1:Date.now(),2:Date.now()},
  exchangeStats:{},nextSerialTxAt:0
 };
 engine.states.set('pack_2',state);
 engine.exchange=async (_s,addr,reg,value=0,quantity=1,expect='frame',options={})=>{
  if(options.beforeSend)options.beforeSend();
  if(expect==='ack'){
   writes.push({addr,reg,value,quantity});
   return Buffer.alloc(8);
  }
  const frame=Buffer.alloc(308);
  frame.writeUInt16LE(0,282);
  frame.writeInt32LE(0,118);
  frame.writeInt32LE(10000,50);
  frame.writeUInt8(0,234);frame.writeUInt8(0,235);frame.writeUInt8(0,236);
  frame.writeInt32LE(10,246);
  frame.writeInt32LE(5,250);
  return frame;
 };
 return {engine,state,writes,events};
}
async function exerciseAccepted(control,value,reg,addr=1){
 const r=rig();
 assert.equal(r.engine.command('pack_2',addr,control,value,false),true,control+' should queue with fresh LIVE');
 await r.engine.step(r.state);
 assert.equal(r.writes.length,1,control+' should issue a guarded RTU write');
 assert.equal(r.writes[0].reg,reg,control+' register');
 assert.equal(r.writes[0].addr,addr,control+' target');
}
async function run(){
 // Fresh, per-BMS LIVE is required; a ready TCP socket is insufficient.
 for(const addr of [0,1,2]){
  const r=rig();
  r.state.lastLive[addr]=0;
  assert.equal(r.engine.command('pack_2',addr,'charging_switch',true,false),false,'No LIVE addr '+addr);
  r.state.lastLive[addr]=Date.now()-r.engine.commandFreshnessMs-1;
  assert.equal(r.engine.command('pack_2',addr,'charging_switch',true,false),false,'Stale LIVE addr '+addr);
  r.state.lastLive[addr]=Date.now()-1000;
  assert.equal(r.engine.command('pack_2',addr,'charging_switch',true,false),true,'Fresh LIVE addr '+addr);
 }
 {
  const r=rig();r.state.bus.ready=false;
  assert.equal(r.engine.command('pack_2',1,'charging_switch',true,false),false,'No queue while transport offline');
 }
 {
  const r=rig();
  assert.equal(r.engine.command('pack_2',1,'charging_switch',true,true),false,'No retained MQTT writes');
  assert.equal(r.engine.command('pack_2',7,'charging_switch',true,false),false,'No unknown BMS');
  r.engine.authorized=()=>false;
  assert.equal(r.engine.command('pack_2',1,'charging_switch',true,false),false,'Authorization remains mandatory');
 }
 // Cancel queued commands on disconnect; reconnect does not replay stale writes.
 {
  const r=rig();
  assert.equal(r.engine.command('pack_2',1,'charging_switch',true,false),true);
  assert.equal(r.state.commands.length,1);
  r.state.bus.ready=false;
  r.engine.connection('pack_2',false);
  assert.equal(r.state.commands.length,0,'Queue cleared on disconnect');
  assert.deepEqual(r.state.lastLive,{},'LIVE proof forgotten on disconnect');
  assert.ok(r.events.some(e=>e.event==='command'&&e.status==='failed'&&e.error==='transport_offline_queue_cancelled'),'Explicit failure event');
  r.state.bus.ready=true;
  r.engine.connection('pack_2',true);
  assert.equal(r.engine.command('pack_2',1,'charging_switch',true,false),false,'Do not trust old LIVE on reconnect');
  await r.engine.step(r.state);
  assert.equal(r.writes.length,0,'Nothing replays after reconnect');
  r.state.lastLive[1]=Date.now();
  assert.equal(r.engine.command('pack_2',1,'charging_switch',true,false),true,'New physical LIVE rearms BMS');
  await r.engine.step(r.state);
  assert.equal(r.writes.length,1,'Fresh operator request only');
 }
 // Even if a command somehow remained in a queue, the transport epoch blocks it.
 {
  const r=rig();r.engine.command('pack_2',1,'charging_switch',true,false);
  r.state.transportEpoch++;
  await r.engine.step(r.state);
  assert.equal(r.writes.length,0);
  assert.ok(r.events.some(e=>e.status==='failed'&&e.error==='transport_changed'));
 }
 // A newer valid BMS 2 frame does not authorize a stale BMS 1 target.
 {
  const r=rig();r.state.lastLive[1]=Date.now()-r.engine.commandFreshnessMs-1;
  r.state.lastLive[2]=Date.now();
  assert.equal(r.engine.command('pack_2',1,'charging_switch',true,false),false);
  assert.equal(r.engine.command('pack_2',2,'charging_switch',true,false),true);
 }
 // A parsed SETUP or STATIC frame is not new LIVE freshness.
 {
  const r=rig();
  r.state.lastLive={};
  r.state.responses=0;
  const buf=Buffer.alloc(308);
  r.engine.publish=Engine.prototype.publish;
  r.engine.publish(r.state,1,0x161e,buf);
  assert.equal(r.state.lastLive[1],undefined,'SETUP must not rearm commands');
  r.engine.publish(r.state,1,0x1620,buf);
  assert.ok(Date.now()-r.state.lastLive[1]<200,'Validated LIVE rearms address 1');
  assert.equal(r.state.lastLive[0],undefined,'Other BMS cannot borrow LIVE freshness');
 }
 // A Serial inter-frame gap cannot bypass the final beforeSend safeguard.
 {
  const r=rig();
  const command={addr:1,transportEpoch:r.state.transportEpoch,expires:performance.now()+15000};
  let tx=0;
  r.state.def.transport='serial';
  r.state.bus.send=()=>{tx++;return true};
  r.engine.waitTransportGap=async()=>{r.state.transportEpoch++;};
  let failure=null;
  try{
   await Engine.prototype.exchange.call(r.engine,r.state,1,0x1114,1,1,'ack',
      {beforeSend:()=>r.engine.assertCommandSafety(r.state,command)});
  }catch(e){failure=e;}
  assert.match(failure?.message||'',/transport_changed/);
  assert.equal(tx,0,'Never transmit after an offline transition during Serial gap');
 }
 // Guard all hardware write families, including address 0 (JK master).
 await exerciseAccepted('display_always_on_switch',true,0x1114,0);
 await exerciseAccepted('charging_switch',true,0x1070);
 await exerciseAccepted('max_charge_current',20,0x102c);
 await exerciseAccepted('dry1_trigger',12,0x14e4);
 await exerciseAccepted('dry1_trigger_value',20,0x14f0);

 // Transport loss during pre-read: no RTU write even after a successful SETUP.
 for(const [control,value] of [
  ['display_always_on_switch',true],
  ['charging_switch',true],
  ['max_charge_current',20],
  ['dry1_trigger',12],
  ['dry1_trigger_value',20]
 ]){
  const r=rig(),exchange=r.engine.exchange;
  assert.equal(r.engine.command('pack_2',1,control,value,false),true);
  r.engine.exchange=async (...args)=>{
   const frame=await exchange(...args);
   if(args[2]===(control.startsWith('dry')?0x161c:0x161e)&&args[5]!=='ack'){
    r.state.transportEpoch++;r.state.lastLive={}; // reconnect during pre-read
   }
   return frame;
  };
  await r.engine.step(r.state);
  assert.equal(r.writes.length,0,control+' must not write after transport changes during pre-read');
  assert.ok(r.events.some(e=>e.event==='command'&&e.status==='failed'),control+' emits failure');
 }
 // Validate the beforeSend callback itself, independently of the pre-read.
 {
  const r=rig(),c={addr:1,transportEpoch:1,expires:performance.now()+15000};
  r.engine.assertCommandSafety(r.state,c);
  r.state.lastLive[1]=Date.now()-r.engine.commandFreshnessMs-100;
  assert.throws(()=>r.engine.assertCommandSafety(r.state,c),/stale_live/);
  r.state.lastLive[1]=Date.now();r.state.bus.ready=false;
  assert.throws(()=>r.engine.assertCommandSafety(r.state,c),/transport_offline/);
 }

 // Frontend guard: both pack availability and BMS age are mandatory.
 const from=script.indexOf('const SCADA_COMMAND_MAX_LIVE_AGE_S=');
 const until=script.indexOf('function controlBool(v){',from);
 assert.ok(from>0&&until>from,'SCADA safety helper missing');
 const pack={id:'pack_2',online:true};
 const b={ageSec:0.8};
 const ctx={currentPacks:[pack],readBms:()=>b};
 const ui=vm.runInNewContext(script.slice(from,until)+'\nscadaCommandAvailability',ctx);
 assert.equal(ui('pack_2','1').ok,true);
 pack.online=false;assert.equal(ui('pack_2','1').ok,false,'Offline pack blocked');
 pack.online=true;b.ageSec=70;assert.equal(ui('pack_2','1').ok,false,'Stale BMS blocked');
 b.ageSec=null;assert.equal(ui('pack_2','1').ok,false,'Unknown age blocked');
 b.ageSec=3;assert.equal(ui('pack_2','1').ok,true);
 // All four write entrypoints are gated, not merely the button.
 for(const name of ['executeDryCommand','executeParameterCommand','requestControlCommand','executeControlCommand']){
  const i=script.indexOf('function '+name+'(');
  assert.ok(i>0,name+' exists');
  const block=script.slice(i,i+1100);
  assert.match(block,/scadaCommandAvailability\(/,name+' must check fresh target');
 }
 assert.match(script,/return \{source,trigger,release,writable:scadaCommandAvailability\(p,b\)\.ok/);
 assert.match(script,/scadaCommandAvailability\(packId,bms\)\.ok && SCADA_WRITABLE_CONTROL_KEYS/);
 assert.match(script,/const input=st\.available&&scadaCommandAvailability\(packId,bms\)\.ok/);
 assert.match(script,/if\(!scadaCommandAvailability\(p,b\)\.ok\)throw new Error\(SCADA_COMMAND_UNCERTAIN\)/);
 assert.match(script,/if\(!scadaCommandAvailability\(packId,bms\)\.ok\)\{setParameterCommand/);
 assert.match(script,/if\(!scadaCommandAvailability\(packId,bms\)\.ok\)\{[\s\S]*?setControlCommand/);
 const flows=JSON.parse(fs.readFileSync('rootfs/etc/node-red/flows.json','utf8'));
 const engineNode=flows.find(n=>n.id==='a47300000000000e');
 assert.ok(engineNode,'Scoped Active Polling command router missing');
 assert.match(engineNode.func,/command_rejected_offline_stale_or_authorization/);
 const cfg=fs.readFileSync('config.yaml','utf8');
 assert.match(cfg,/^version: 1\.0\.0-dev80\.0$/m);

 console.log('PASS dev80-0-command-offline-safety.test.cjs');
}
run().catch(err=>{console.error(err);process.exitCode=1;});
