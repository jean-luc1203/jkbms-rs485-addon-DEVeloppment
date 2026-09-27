'use strict';
// Independent Multi-Pack RTU engine. No Legacy globals, no shared slave counter.
// v4.2.90: add direct USB/Serial transport alongside the validated TCP transport.
// Existing v4.2.84-v4.2.89 controls keep the same register mapping and write/readback path.
const net = require('net');
const {performance} = require('perf_hooks');
const runtimes = new Map();

const CONTROL_DEFS = Object.freeze({
 display_always_on_switch: {kind:'switch', register:0x1114, mask:0x0010},
 heating_switch: {kind:'switch', register:0x1114, mask:0x0001},
 // v4.2.88 - shared 0x1114 read/modify/write controls. The masks are
 // exactly the masks used by the existing Legacy writers.
 smart_sleep_switch: {kind:'switch', register:0x1114, mask:0x0040},
 disable_pcl_module_switch: {kind:'switch', register:0x1114, mask:0x0080},
 timed_stored_data_switch: {kind:'switch', register:0x1114, mask:0x0100},
 charging_floating_mode: {kind:'switch', register:0x1114, mask:0x0200},
 // v4.2.88 - SETUP booleans stored as signed 32-bit 0/1 values.
 charging_switch: {kind:'switch32', register:0x1070, offset:118},
 discharging_switch: {kind:'switch32', register:0x1074, offset:122},
 balance_switch: {kind:'switch32', register:0x1078, offset:126},
 // v4.2.89 - Legacy writer: register 0x1000, millivolts, accepted range 2.5..4.5 V.
 smart_sleep_voltage: {kind:'number', register:0x1000, offset:6, scale:1000, min:2.5, max:4.5},
 // Keep these ranges aligned with the currently validated Legacy write paths.
 max_charge_current: {kind:'number', register:0x102C, offset:50, scale:1000, min:0, max:150},
 max_discharge_current: {kind:'number', register:0x1038, offset:62, scale:1000, min:0, max:150},
 total_battery_capacity_ah: {kind:'number', register:0x107C, offset:130, scale:1000, min:1, max:2000},
 balance_trigger_voltage: {kind:'number', register:0x1014, offset:26, scale:1000, min:0.003, max:1},
 balance_starting_voltage: {kind:'number', register:0x1084, offset:138, scale:1000, min:1.2, max:4.25},
 cell_voltage_undervoltage_protection: {kind:'number', register:0x1004, offset:10, scale:1000, min:2.5, max:4.5},
 cell_voltage_undervoltage_recovery: {kind:'number', register:0x1008, offset:14, scale:1000, min:2.5, max:4.5},
 cell_voltage_overvoltage_protection: {kind:'number', register:0x100C, offset:18, scale:1000, min:2.5, max:4.5},
 cell_voltage_overvoltage_recovery: {kind:'number', register:0x1010, offset:22, scale:1000, min:2.5, max:4.5},
 cell_soc100_voltage: {kind:'number', register:0x1018, offset:30, scale:1000, min:2.5, max:4.5},
 cell_soc0_voltage: {kind:'number', register:0x101C, offset:34, scale:1000, min:2.5, max:4.5},
 cell_request_charge_voltage: {kind:'number', register:0x1020, offset:38, scale:1000, min:2.5, max:4.5},
 cell_request_float_voltage: {kind:'number', register:0x1024, offset:42, scale:1000, min:2.5, max:4.5},
 power_off_voltage: {kind:'number', register:0x1028, offset:46, scale:1000, min:1.8, max:3.0},
 // v4.2.86 - protection timing / recovery + max balance current.
 // Ranges follow the current Legacy discovery/write paths.
 charge_overcurrent_protection_delay: {kind:'number', register:0x1030, offset:54, scale:1, min:2, max:600, integer:true},
 charge_overcurrent_protection_recovery_time: {kind:'number', register:0x1034, offset:58, scale:1, min:2, max:3600, integer:true},
 discharge_overcurrent_protection_delay: {kind:'number', register:0x103C, offset:66, scale:1, min:2, max:600, integer:true},
 discharge_overcurrent_protection_recovery_time: {kind:'number', register:0x1040, offset:70, scale:1, min:2, max:3600, integer:true},
 short_circuit_protection_recovery_time: {kind:'number', register:0x1044, offset:74, scale:1, min:2, max:600, integer:true},
 max_balance_current: {kind:'number', register:0x1048, offset:78, scale:1000, min:0, max:2},
 short_circuit_protection_delay: {kind:'number', register:0x1080, offset:134, scale:1, min:0, max:5000, integer:true},
 // v4.2.87 - thermal protection thresholds. Protocol stores signed 0.1 °C.
 // Bounds and HA steps mirror the current Legacy SETUP discovery/write path.
 charge_overtemperature_protection: {kind:'number', register:0x104C, offset:82, scale:10, min:-40, max:150},
 charge_overtemperature_protection_recovery: {kind:'number', register:0x1050, offset:86, scale:10, min:-40, max:150},
 discharge_overtemperature_protection: {kind:'number', register:0x1054, offset:90, scale:10, min:-40, max:150},
 discharge_overtemperature_protection_recovery: {kind:'number', register:0x1058, offset:94, scale:10, min:-40, max:150},
 charge_undertemperature_protection: {kind:'number', register:0x105C, offset:98, scale:10, min:-40, max:50},
 charge_undertemperature_protection_recovery: {kind:'number', register:0x1060, offset:102, scale:10, min:-40, max:50},
 power_tube_overtemperature_protection: {kind:'number', register:0x1064, offset:106, scale:10, min:30, max:100},
 power_tube_overtemperature_protection_recovery: {kind:'number', register:0x1068, offset:110, scale:10, min:30, max:100}
});

function crc(b) { let c=65535; for(const v of b){c^=v;for(let i=0;i<8;i++)c=c&1?(c>>>1)^0xa001:c>>>1;}return c; }
function packet(b){return Buffer.concat([b,Buffer.from([crc(b)&255,crc(b)>>>8])]);}
function request(a,r,v=0,quantity=1){
 let b;
 if(quantity===1){
  b=Buffer.alloc(9);
  b[0]=a;b[1]=16;b.writeUInt16BE(r,2);b.writeUInt16BE(1,4);b[6]=2;b.writeUInt16BE(Number(v)&0xffff,7);
 }else if(quantity===2){
  b=Buffer.alloc(11);
  b[0]=a;b[1]=16;b.writeUInt16BE(r,2);b.writeUInt16BE(2,4);b[6]=4;b.writeInt32BE(Number(v),7);
 }else throw new Error('unsupported_quantity');
 return packet(b);
}
function parse(buffer){
 const frames=[];let b=buffer;
 while(b.length>=5){
  let n=0;
  if(b.subarray(0,4).equals(Buffer.from('55aaeb90','hex')))n=308;
  else if(b[0]>=1&&b[0]<=15&&b[1]===16)n=8;
  else if(b[0]>=1&&b[0]<=15&&b[1]===0x90)n=5;
  else {b=b.subarray(1);continue;}
  if(b.length<n)break;
  const f=b.subarray(0,n);
  const valid=n===308?(f.subarray(0,299).reduce((a,v)=>a+v,0)&255)===f[299]&&crc(f.subarray(300,306))===f.readUInt16LE(306):crc(f.subarray(0,n-2))===f.readUInt16LE(n-2);
  if(!valid){b=b.subarray(1);continue;}
  frames.push(Buffer.from(f));b=b.subarray(n);
 }
 return {frames,tail:Buffer.from(b)};
}
let SerialPortCtor = null;
function getSerialPortCtor(){
 if(SerialPortCtor)return SerialPortCtor;
 let mod;
 try{mod=require('serialport');}
 catch(e){throw new Error('serialport_unavailable: '+e.message);}
 SerialPortCtor=mod&&mod.SerialPort?mod.SerialPort:mod;
 if(typeof SerialPortCtor!=='function')throw new Error('serialport_module_invalid');
 return SerialPortCtor;
}

class TcpBus {
 constructor(def,owner){this.def=def;this.owner=owner;this.socket=null;this.pending=null;this.closed=false;this.buffer=Buffer.alloc(0);this.timer=null;this.retry=null;this.ready=false;this.connectionTimer=null;}
 connect(){
  if(this.closed)return;
  const s=net.createConnection({host:this.def.host,port:this.def.port});this.socket=s;s.setNoDelay(true);
  this.connectionTimer=setTimeout(()=>s.destroy(new Error('connect_timeout')),2000);
  s.on('connect',()=>{clearTimeout(this.connectionTimer);this.ready=true;this.owner.connection(this.def.id,true);this.owner.wake(this.def.id);});
  s.on('data',data=>{
   if(s!==this.socket||!this.ready)return;
   const parsed=parse(Buffer.concat([this.buffer,data]));this.buffer=parsed.tail;
   if(this.buffer.length>4096){s.destroy(new Error('receive_overflow'));return;}
   for(const f of parsed.frames){
    const p=this.pending;if(!p)continue;
    const tail=f.length===308?f.subarray(300):f;
    if(tail[0]!==p.addr)continue;
    if(f.length===5){this.finish(new Error('modbus_exception_'+f[2]));continue;}
    if(tail[1]!==16||tail.readUInt16BE(2)!==p.reg||tail.readUInt16BE(4)!==p.quantity)continue;
    if(p.expect==='ack'){
     if(f.length!==8)continue;
    }else{
     if(f.length!==308||f[4]!==({5660:3,5662:1,5664:2})[p.reg])continue;
     if(p.reg===0x161e&&f.readUInt32LE(270)!==p.addr)continue;
    }
    this.finish(null,f);
   }
  });
  s.on('error',e=>this.owner.error(this.def.id,e.message));
  s.on('close',()=>{if(s!==this.socket)return;clearTimeout(this.connectionTimer);this.ready=false;this.buffer=Buffer.alloc(0);this.owner.connection(this.def.id,false);this.finish(new Error('connection_closed'));if(!this.closed)this.retry=setTimeout(()=>this.connect(),1500);});
 }
 finish(error,frame){const p=this.pending;if(!p)return;this.pending=null;clearTimeout(this.timer);p.done(error,frame);}
 send(addr,reg,value,quantity,expect,done){
  if(!this.ready||this.pending||this.closed)return false;
  this.pending={addr,reg,quantity,expect,done};
  this.timer=setTimeout(()=>{ // close socket before any next transaction: quarantine late replies
   this.ready=false;this.socket.destroy();this.finish(new Error('response_timeout'));
  },this.owner.timeoutMs);
  this.socket.write(request(addr,reg,value,quantity));return true;
 }
 stop(){this.closed=true;clearTimeout(this.retry);clearTimeout(this.connectionTimer);clearTimeout(this.timer);this.ready=false;this.finish(new Error("stopped"));if(this.socket)this.socket.destroy();}
}

class SerialBus {
 constructor(def,owner){
  this.def=def;this.owner=owner;this.port=null;this.pending=null;this.closed=false;
  this.buffer=Buffer.alloc(0);this.timer=null;this.retry=null;this.ready=false;
  this.connectionTimer=null;this.lastTx=null;
 }
 scheduleRetry(){
  if(this.closed)return;
  clearTimeout(this.retry);
  this.retry=setTimeout(()=>this.connect(),1500);
 }
 connect(){
  if(this.closed)return;
  clearTimeout(this.retry);
  let SerialPort;
  try{SerialPort=getSerialPortCtor();}
  catch(e){this.owner.error(this.def.id,e.message);this.scheduleRetry();return;}
  const p=new SerialPort({
   path:this.def.path,
   baudRate:Number(this.def.baudRate)||115200,
   dataBits:8,
   stopBits:1,
   parity:'none',
   autoOpen:false,
   lock:true,
   rtscts:false,
   xon:false,
   xoff:false,
   xany:false
  });
  this.port=p;this.buffer=Buffer.alloc(0);this.lastTx=null;
  this.connectionTimer=setTimeout(()=>{
   if(p!==this.port||this.ready||this.closed)return;
   this.owner.error(this.def.id,'serial_connect_timeout');
   try{if(p.isOpen)p.close(()=>{});}catch(_){}
   if(!p.isOpen){this.port=null;this.scheduleRetry();}
  },2000);
  p.on('open',()=>{
   if(p!==this.port||this.closed){
    try{if(p.isOpen)p.close(()=>{});}catch(_){}
    return;
   }
   clearTimeout(this.connectionTimer);
   const markReady=()=>{
    if(p!==this.port||this.closed)return;
    this.ready=true;
    this.owner.connection(this.def.id,true);
    this.owner.wake(this.def.id);
   };
   if(typeof p.flush==='function'){
    p.flush(err=>{
     if(err)this.owner.error(this.def.id,'serial_flush: '+err.message);
     markReady();
    });
   }else markReady();
  });
  p.on('data',data=>{
   if(p!==this.port||!this.ready)return;
   this.buffer=Buffer.concat([this.buffer,data]);
   // Some USB/RS485 adapters echo the transmitted RTU request. Strip exactly
   // one complete echo before feeding the common JK/RTU frame parser.
   if(this.lastTx){
    if(this.buffer.length<this.lastTx.length &&
       this.lastTx.subarray(0,this.buffer.length).equals(this.buffer))return;
    if(this.buffer.length>=this.lastTx.length &&
       this.buffer.subarray(0,this.lastTx.length).equals(this.lastTx)){
      this.buffer=this.buffer.subarray(this.lastTx.length);
    }
    this.lastTx=null;
   }
   const parsed=parse(this.buffer);this.buffer=parsed.tail;
   if(this.buffer.length>4096){this.reset(new Error('receive_overflow'));return;}
   for(const f of parsed.frames){
    const pending=this.pending;if(!pending)continue;
    const tail=f.length===308?f.subarray(300):f;
    if(tail[0]!==pending.addr)continue;
    if(f.length===5){this.finish(new Error('modbus_exception_'+f[2]));continue;}
    if(tail[1]!==16||tail.readUInt16BE(2)!==pending.reg||tail.readUInt16BE(4)!==pending.quantity)continue;
    if(pending.expect==='ack'){
     if(f.length!==8)continue;
    }else{
     if(f.length!==308||f[4]!==({5660:3,5662:1,5664:2})[pending.reg])continue;
     if(pending.reg===0x161e&&f.readUInt32LE(270)!==pending.addr)continue;
    }
    this.finish(null,f);
   }
  });
  p.on('error',e=>{
   if(p!==this.port)return;
   this.owner.error(this.def.id,'serial: '+e.message);
   if(this.ready)this.reset(new Error('serial_error'));
  });
  p.on('close',()=>{
   if(p!==this.port)return;
   clearTimeout(this.connectionTimer);
   this.ready=false;this.buffer=Buffer.alloc(0);this.lastTx=null;this.port=null;
   this.owner.connection(this.def.id,false);
   this.finish(new Error('connection_closed'));
   this.scheduleRetry();
  });
  try{
   p.open(err=>{
    if(!err||p!==this.port)return;
    clearTimeout(this.connectionTimer);
    this.owner.error(this.def.id,'serial_open: '+err.message);
    this.ready=false;this.port=null;this.finish(new Error('serial_open_failed'));
    this.scheduleRetry();
   });
  }catch(e){
   clearTimeout(this.connectionTimer);
   this.owner.error(this.def.id,'serial_open: '+e.message);
   this.port=null;this.scheduleRetry();
  }
 }
 finish(error,frame){const p=this.pending;if(!p)return;this.pending=null;clearTimeout(this.timer);p.done(error,frame);}
 reset(error){
  if(this.closed)return;
  this.ready=false;this.buffer=Buffer.alloc(0);this.lastTx=null;this.finish(error);
  const p=this.port;
  if(p&&p.isOpen){
   try{p.close(()=>{});}catch(_){this.port=null;this.scheduleRetry();}
  }else{
   this.port=null;this.scheduleRetry();
  }
 }
 send(addr,reg,value,quantity,expect,done){
  if(!this.ready||this.pending||this.closed||!this.port)return false;
  const frame=request(addr,reg,value,quantity);
  this.pending={addr,reg,quantity,expect,done};this.lastTx=frame;
  this.timer=setTimeout(()=>this.reset(new Error('response_timeout')),this.owner.timeoutMs);
  const p=this.port;
  try{
   p.write(frame,e=>{
    if(p!==this.port||this.closed)return;
    if(e){this.owner.error(this.def.id,'serial_write: '+e.message);this.reset(new Error('serial_write_error'));return;}
    if(typeof p.drain==='function'){
     p.drain(err=>{
      if(p!==this.port||this.closed)return;
      if(err){this.owner.error(this.def.id,'serial_drain: '+err.message);this.reset(new Error('serial_drain_error'));}
     });
    }
   });
  }catch(e){
   this.owner.error(this.def.id,'serial_write: '+e.message);this.reset(new Error('serial_write_error'));
  }
  return true;
 }
 stop(){
  this.closed=true;clearTimeout(this.retry);clearTimeout(this.connectionTimer);clearTimeout(this.timer);
  this.ready=false;this.finish(new Error('stopped'));
  const p=this.port;this.port=null;
  if(p&&p.isOpen){try{p.close(()=>{});}catch(_){}}
 }
}

function createBus(def,owner){
 if(def.transport==='serial')return new SerialBus(def,owner);
 return new TcpBus(def,owner);
}

class Engine {
 constructor(config,emit,authorized){
  this.emit=emit;this.authorized=authorized;this.stopped=false;this.timeoutMs=config.timeoutMs||1000;this.intervalMs=config.intervalMs||3000;this.states=new Map();
  for(const d of config.packs){
   const state={def:d,bus:createBus(d,this),due:[],commands:[],running:false,timer:null,lastError:null,lastLive:{},responses:0};
   for(const addr of d.bms_addresses)for(const reg of [0x161e,0x161c,0x1620])state.due.push({addr,reg,at:0});
   this.states.set(d.id,state);state.bus.connect();
  }
 }
 connection(id,online){const s=this.states.get(id);if(!this.stopped)this.emit({event:'connection',pack_id:id,transport:s?.def?.transport,bus_id:s?.def?.bus_id,online});}
 error(id,error){const s=this.states.get(id);if(!this.stopped)this.emit({event:'error',pack_id:id,transport:s?.def?.transport,bus_id:s?.def?.bus_id,error});}
 wake(id,delay=0){const s=this.states.get(id);if(!s||this.stopped)return;clearTimeout(s.timer);s.timer=setTimeout(()=>this.step(s),delay);}
 publish(s,addr,reg,frame){if(this.stopped)return;s.responses++;if(reg===0x1620)s.lastLive[addr]=Date.now();this.emit({event:'frame',pack_id:s.def.id,pack_name:s.def.name,bus_id:s.def.bus_id,_transport:s.def.transport,bms_numero:addr,register:reg,payload:frame});}
 status(s,c,status,extra={}){if(this.stopped)return;this.emit({event:'command',pack_id:s.def.id,transport:s.def.transport,bus_id:s.def.bus_id,bms_numero:c.addr,control:c.control,status,command_id:c.id,requested_value:c.value,register:c.def.register,...extra});}
 command(pack,addr,control,value,retained){
  const s=this.states.get(pack), def=CONTROL_DEFS[control];
  if(!s||!s.def.bms_addresses.includes(addr)||!def||retained||!this.authorized())return false;
  if(def.kind==='switch'||def.kind==='switch32'){
   if(typeof value!=='boolean')return false;
  }else{
   if(typeof value!=='number'||!Number.isFinite(value)||value<def.min||value>def.max)return false;
   if(def.integer===true&&!Number.isInteger(value))return false;
  }
  if(s.commands.length>=16)return false;
  const c={addr,control,value,def,id:Date.now().toString(36)+'-'+Math.random().toString(16).slice(2,8),expires:performance.now()+15000};
  s.commands.push(c);this.status(s,c,'queued');this.wake(pack);return true;
 }
 async exchange(s,addr,reg,value=0,quantity=1,expect='frame'){return new Promise((resolve,reject)=>{if(!s.bus.send(addr,reg,value,quantity,expect,(e,f)=>e?reject(e):resolve(f)))reject(new Error('not_connected'));});}
 async step(s){
  if(this.stopped||s.running||!s.bus.ready)return;
  s.running=true;
  try {
   const c=s.commands.shift();
   if(c){
    try{
     if(performance.now()>c.expires)throw new Error('command_expired');
     if(!this.authorized())throw new Error('not_authorized');
     // Fresh SETUP read on the exact BMS before every command. This keeps the
     // same isolation and readback discipline already validated for 0x1114.
     const before=await this.exchange(s,c.addr,0x161e);this.publish(s,c.addr,0x161e,before);
     if(c.def.kind==='switch'){
      const old=before.readUInt16LE(282), desired=c.value?old|c.def.mask:old&~c.def.mask;
      if(!this.authorized()||performance.now()>c.expires)throw new Error('authorization_or_expiry');
      if(desired!==old){await this.exchange(s,c.addr,0x1114,desired,1,'ack');this.status(s,c,'acknowledged',{previous_value:Boolean(old&c.def.mask),encoded_value:desired});}
      const after=await this.exchange(s,c.addr,0x161e);this.publish(s,c.addr,0x161e,after);
      const readback=Boolean(after.readUInt16LE(282)&c.def.mask);
      this.status(s,c,readback===c.value?'confirmed':'not_confirmed',{readback_value:readback,encoded_value:desired});
     }else if(c.def.kind==='switch32'){
      const oldRaw=before.readInt32LE(c.def.offset), oldValue=oldRaw!==0, desiredRaw=c.value?1:0;
      if(!this.authorized()||performance.now()>c.expires)throw new Error('authorization_or_expiry');
      if(desiredRaw!==oldRaw){await this.exchange(s,c.addr,c.def.register,desiredRaw,2,'ack');this.status(s,c,'acknowledged',{previous_value:oldValue,encoded_value:desiredRaw});}
      const after=await this.exchange(s,c.addr,0x161e);this.publish(s,c.addr,0x161e,after);
      const readbackRaw=after.readInt32LE(c.def.offset), readback=readbackRaw!==0;
      this.status(s,c,readbackRaw===desiredRaw?'confirmed':'not_confirmed',{previous_value:oldValue,readback_value:readback,encoded_value:desiredRaw});
     }else{
      const oldRaw=before.readInt32LE(c.def.offset), oldValue=oldRaw/c.def.scale;
      const desiredRaw=Math.round(c.value*c.def.scale), desiredValue=desiredRaw/c.def.scale;
      if(!this.authorized()||performance.now()>c.expires)throw new Error('authorization_or_expiry');
      if(desiredRaw!==oldRaw){await this.exchange(s,c.addr,c.def.register,desiredRaw,2,'ack');this.status(s,c,'acknowledged',{previous_value:oldValue,encoded_value:desiredRaw});}
      const after=await this.exchange(s,c.addr,0x161e);this.publish(s,c.addr,0x161e,after);
      const readbackRaw=after.readInt32LE(c.def.offset), readbackValue=readbackRaw/c.def.scale;
      this.status(s,c,readbackRaw===desiredRaw?'confirmed':'not_confirmed',{previous_value:oldValue,readback_value:readbackValue,encoded_value:desiredRaw,normalized_value:desiredValue});
     }
    }catch(e){this.status(s,c,'failed',{error:e.message});}
   }else{
    s.due.sort((a,b)=>a.at-b.at);
    const job=s.due[0];
    if(job.at>performance.now())return;
    job.at=performance.now()+(job.reg===0x1620?this.intervalMs:job.reg===0x161e?20000:60000);
    try{const f=await this.exchange(s,job.addr,job.reg);this.publish(s,job.addr,job.reg,f);}catch(e){this.error(s.def.id,e.message);}
   }
  }finally{
   s.running=false;
   if(!this.stopped){const next=s.commands.length?25:Math.max(25,Math.min(...s.due.map(j=>j.at))-performance.now());this.wake(s.def.id,Math.min(next,1000));}
  }
 }
 stop(){this.stopped=true;for(const s of this.states.values()){clearTimeout(s.timer);s.bus.stop();}this.states.clear();}
}
function validate(config){
 if(!config||!Array.isArray(config.packs)||config.packs.length<1||config.packs.length>5)throw new Error('Invalid pack configuration');
 const physical=new Set(),ids=new Set();
 for(const p of config.packs){
  if(!/^pack_[1-5]$/.test(p.id)||ids.has(p.id))throw new Error('Invalid or duplicate pack id');
  ids.add(p.id);
  let key;
  if(p.transport==='tcp'){
   if(typeof p.host!=='string'||!p.host||!Number.isInteger(p.port)||p.port<1||p.port>65535)throw new Error('Invalid TCP pack');
   key='tcp:'+p.host.toLowerCase()+':'+p.port;
  }else if(p.transport==='serial'){
   if(typeof p.path!=='string'||!p.path.trim())throw new Error('Invalid serial pack');
   if(p.baudRate!==undefined&&(!Number.isInteger(Number(p.baudRate))||Number(p.baudRate)<1200||Number(p.baudRate)>3000000))throw new Error('Invalid serial baud rate');
   key='serial:'+p.path.trim().toLowerCase();
  }else throw new Error('Invalid pack transport');
  if(physical.has(key))throw new Error('Duplicate transport endpoint');
  physical.add(key);
  if(!Array.isArray(p.bms_addresses)||!p.bms_addresses.length||p.bms_addresses.some(a=>!Number.isInteger(a)||a<1||a>15)||new Set(p.bms_addresses).size!==p.bms_addresses.length)throw new Error('Explicit BMS addresses required');
 }
}
module.exports={crc,packet,request,parse,CONTROL_DEFS,Engine,validate,
 start(id,config,emit,authorized){validate(config);const signature=JSON.stringify(config);const old=runtimes.get(id);if(old&&old.signature===signature)return;this.stop(id);const engine=new Engine(config,emit,authorized);runtimes.set(id,{engine,signature});},
 snapshot(id){const r=runtimes.get(id);if(!r)return [];return [...r.engine.states.values()].map(s=>({event:'health',pack_id:s.def.id,transport:s.def.transport,bus_id:s.def.bus_id,endpoint:s.def.transport==='serial'?s.def.path:`${s.def.host}:${s.def.port}`,connected:s.bus.ready,configured_bms:s.def.bms_addresses,last_live_ms:{...s.lastLive},validated_responses:s.responses,queued_commands:s.commands.length}));},
 command(id,...args){const r=runtimes.get(id);return r?r.engine.command(...args):false;},
 stop(id){const r=runtimes.get(id);if(r){r.engine.stop();runtimes.delete(id);}}
};
