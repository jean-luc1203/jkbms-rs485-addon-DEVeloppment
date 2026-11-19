'use strict';
const assert=require('node:assert/strict');
const {Engine}=require('../rootfs/etc/node-red/active-polling.js');

// Engine-only harness: no MQTT client, Home Assistant or physical serial/TCP bus.
// A fake bus never opens a socket or issues a real BMS write.
const newEngine=()=>{
 const events=[];
 const engine=Object.create(Engine.prototype);
 engine.emit=evt=>events.push(evt);
 engine.authorized=()=>true;
 engine.stopped=false;
 engine.timeoutMs=1000;
 engine.intervalMs=3000;
 engine.serialInterFrameMs=0;
 engine.wake=()=>{};
 engine.publish=()=>{};
 const one=(id,addr,transport)=>({
  def:{id,transport,bus_id:id,bms_addresses:[addr]},
  bus:{ready:true},commands:[],due:[],running:false,timer:null,
  autoDiscovery:false,discoveryComplete:true,sessionEpoch:1,lastLive:{},
  lastError:null,exchangeStats:{},activeDry:null
 });
 const berlin=one('pack_2',1,'tcp');
 const local=one('pack_1',0,'serial');
 engine.states=new Map([['pack_2',berlin],['pack_1',local]]);
 return {engine,berlin,local,events};
};
const enqueue=(engine,pack,addr,control='display_always_on_switch',value=true)=>
 engine.command(pack,addr,control,value,false);
const hasStatus=(events,status,error)=>events.some(e=>e.event==='command'&&e.status===status&&
 (error===undefined||e.error===error));

async function main(){
 {
  const {engine,berlin,local}=newEngine();
  assert.equal(enqueue(engine,'pack_2',1),false,'Boot without a fresh LIVE must refuse writes');
  berlin.lastLive[1]=Date.now()-30000;
  assert.equal(enqueue(engine,'pack_2',1),false,'Retained but stale LIVE must refuse writes');
  berlin.lastLive[1]=Date.now();
  berlin.bus.ready=false;
  assert.equal(enqueue(engine,'pack_2',1),false,'Disconnected TCP must refuse writes');
  berlin.bus.ready=true;
  assert.equal(enqueue(engine,'pack_2',1),true,'Fresh LIVE on connected TCP permits queueing');
  assert.equal(berlin.commands.length,1);
  assert.equal(enqueue(engine,'pack_1',0),false,'Fresh Berlin LIVE cannot authorize pack 1/BMS0');
  local.lastLive[0]=Date.now();
  assert.equal(enqueue(engine,'pack_1',0),true,'Physical address zero remains valid on independent serial pack');
  assert.equal(local.commands.length,1);
  assert.equal(enqueue(engine,'pack_2',0),false,'No cross-pack BMS address borrowing');
 }
 {
  const {engine,berlin,local,events}=newEngine();
  berlin.lastLive[1]=Date.now();
  local.lastLive[0]=Date.now();
  assert.equal(enqueue(engine,'pack_2',1),true);
  assert.equal(enqueue(engine,'pack_1',0),true);
  berlin.bus.ready=false;
  engine.connection('pack_2',false);
  assert.equal(berlin.commands.length,0,'Offline must drain queued writes');
  assert.ok(hasStatus(events,'failed','connection_changed_before_dispatch'),'Dropped write is explicitly failed/audited');
  assert.equal(Object.keys(berlin.lastLive).length,0,'No retained LIVE across session boundaries');
  assert.equal(local.commands.length,1,'Berlin failure must not affect serial pack 1');
  berlin.bus.ready=true;
  engine.connection('pack_2',true);
  assert.equal(enqueue(engine,'pack_2',1),false,'After reconnect, wait for new physical LIVE');
  berlin.lastLive[1]=Date.now();
  assert.equal(enqueue(engine,'pack_2',1),true,'New physical LIVE unlocks new request');
  assert.equal(berlin.commands.at(-1).sessionEpoch,berlin.sessionEpoch);
 }
 {
  const {engine,berlin,events}=newEngine();
  berlin.lastLive[1]=Date.now();
  enqueue(engine,'pack_2',1);
  let writes=0;
  engine.exchange=async (_s,_a,reg,_value,_qty,expect,opts={})=>{
   if(reg===0x161e && expect!=='ack'){
    berlin.bus.ready=false;
    engine.connection('pack_2',false);
    return Buffer.alloc(308);
   }
   if(opts.beforeSend)opts.beforeSend();
   if(expect==='ack')writes++;
   return Buffer.alloc(308);
  };
  await engine.step(berlin);
  assert.equal(writes,0,'Disconnect while reading pre-write SETUP may never result in a write');
  assert.ok(hasStatus(events,'failed','connection_changed'),'In-flight request must fail on changed session');
 }
 {
  const {engine,berlin,events}=newEngine();
  berlin.lastLive[1]=Date.now();
  enqueue(engine,'pack_2',1);
  let writes=0,reads=0;
  engine.exchange=async (_s,_a,reg,_value,_qty,expect,opts={})=>{
   if(expect==='ack'){
    berlin.bus.ready=false;
    engine.connection('pack_2',false);
    if(opts.beforeSend)opts.beforeSend();
    writes++;
    return Buffer.alloc(8);
   }
   const frame=Buffer.alloc(308);
   if(reads++>0)frame.writeUInt16LE(16,282);
   return frame;
  };
  await engine.step(berlin);
  assert.equal(writes,0,'Guard inside beforeSend must stop write if disconnected after pre-read');
  assert.ok(hasStatus(events,'failed','connection_changed'));
 }
 {
  const {engine,berlin,events}=newEngine();
  berlin.lastLive[1]=Date.now();
  enqueue(engine,'pack_2',1);
  let writes=0,readCount=0;
  engine.exchange=async (_s,_a,reg,_value,_qty,expect,opts={})=>{
   if(opts.beforeSend)opts.beforeSend();
   if(expect==='ack'){writes++;return Buffer.alloc(8);}
   const frame=Buffer.alloc(308);
   frame.writeUInt16LE(readCount++?16:0,282);
   return frame;
  };
  await engine.step(berlin);
  assert.equal(writes,1,'A valid fresh request must still send a write');
  assert.ok(hasStatus(events,'confirmed'),'Readback must still confirm a normal valid command');
 }
 {
  const {engine,berlin,events}=newEngine();
  berlin.lastLive[1]=Date.now();
  enqueue(engine,'pack_2',1);
  let writes=0,readCount=0;
  engine.exchange=async (_s,_a,reg,_value,_qty,expect,opts={})=>{
   if(opts.beforeSend)opts.beforeSend();
   if(expect==='ack'){writes++;return Buffer.alloc(8);}
   const frame=Buffer.alloc(308);
   frame.writeUInt16LE(readCount++?16:0,282);
   if(readCount===2){berlin.bus.ready=false;engine.connection('pack_2',false);}
   return frame;
  };
  await engine.step(berlin);
  assert.equal(writes,1,'Already physically transmitted writes cannot be undone');
  assert.equal(hasStatus(events,'confirmed'),false,'After disconnect, an ambiguous response cannot be claimed confirmed');
  assert.ok(hasStatus(events,'failed','connection_changed'),'Result must remain uncertain/failed');
 }
 // Check all write branches actually carry a beforeSend guard.
 const fs=require('node:fs');
 const code=fs.readFileSync('rootfs/etc/node-red/active-polling.js','utf8');
 const writes=[...code.matchAll(/await this\.exchange\(s,c\.addr,[^\n]*,'ack',[^\n]*\)/g)].map(x=>x[0]);
 assert.ok(writes.length>=5,'Expected switch, switch32, number and both DRY write paths');
 for(const call of writes)assert.match(call,/beforeSend:\(\)=>this\.assertCommandSession\(s,c\)/);
 console.log('PASS dev80-0-command-session-freshness.test.cjs');
}
main().catch(e=>{console.error(e);process.exitCode=1});
