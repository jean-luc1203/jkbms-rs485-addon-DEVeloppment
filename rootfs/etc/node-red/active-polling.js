'use strict';
// Independent Multi-Pack RTU engine. No Legacy globals, no shared slave counter.
// dev71 candidate: permit address 0 on the independently addressed JK UART1 RTU bus.
// Address 0 is treated as a normal, explicitly targeted JK address here;
// no Modbus broadcast semantics or changes to Legacy/Broadcasting are introduced.
// v4.2.99 / dev70: automatic BMS discovery + writable DRY1/DRY2 configuration.
// DRY trigger source/value/release writes use the JK 0x1400 Modbus block and
// are confirmed only after a fresh STATIC / device-info (0x161C) readback.
// LIVE byte 281 remains state-only and is never written.
// v4.2.98: automatic BMS discovery for Multi-Pack Active Polling.
// Empty/omitted bms_addresses (or bms_discovery="auto") scans addresses 0..15.
// Discovery uses a short dedicated timeout and does NOT apply normal runtime
// timeout/reset semantics to expected absent addresses.
// v4.2.93 100 ms Serial quiet time and the 1000 ms normal runtime timeout remain unchanged.
// Legacy communication is outside this module and is not modified.
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
 power_tube_overtemperature_protection_recovery: {kind:'number', register:0x1068, offset:110, scale:10, min:30, max:100},
 // dev70 - DRY1/DRY2 configuration lives in the STATIC / Device Info map
 // (Modbus 0x1400 block), not in SETUP and not in LIVE byte 281.
 //
 // Source registers share one 16-bit Modbus word with a neighbouring byte:
 //   0x14E4 = [LCD buzzer trigger][DRY1 trigger]
 //   0x14E6 = [DRY2 trigger][UART protocol library version]
 //
 // Trigger / release values are signed 32-bit raw values. Their engineering
 // unit depends on the selected trigger source; the SCADA layer may translate
 // these values for display, but this engine writes and verifies the raw value.
 dry1_trigger: {kind:'static_select', register:0x14E4, offset:235, neighborOffset:234, byte:'low', dry:1, min:0, max:14, integer:true},
 dry2_trigger: {kind:'static_select', register:0x14E6, offset:236, neighborOffset:237, byte:'high', dry:2, min:0, max:14, integer:true},
 dry1_trigger_value: {kind:'static_number', register:0x14F0, offset:246, dry:1, role:'trigger', min:-2147483648, max:2147483647, integer:true},
 dry1_release_value: {kind:'static_number', register:0x14F4, offset:250, dry:1, role:'release', min:-2147483648, max:2147483647, integer:true},
 dry2_trigger_value: {kind:'static_number', register:0x14F8, offset:254, dry:2, role:'trigger', min:-2147483648, max:2147483647, integer:true},
 dry2_release_value: {kind:'static_number', register:0x14FC, offset:258, dry:2, role:'release', min:-2147483648, max:2147483647, integer:true}
});

// Raw signed INT32 bounds are representation limits, NOT hardware operating ranges.
// The supplied Modbus V1.1 map specifies no DRY threshold scale or valid range.
// Only trigger 8 has field evidence for direct °C (60/50 on the operator's BMS).
const DRY_TRIGGER_RULES = Object.freeze({
 0:{label:'Off',hasValues:false},
 1:{label:'Low SoC',hasValues:true,relation:'lt'},
 2:{label:'Battery Over Voltage',hasValues:true,relation:'gt'},
 3:{label:'Battery Under Voltage',hasValues:true,relation:'lt'},
 4:{label:'Battery Cell Over Voltage',hasValues:true,relation:'gt'},
 5:{label:'Battery Cell Under Voltage',hasValues:true,relation:'lt'},
 6:{label:'Charge Over Current',hasValues:true,relation:'gt'},
 7:{label:'Discharge Over Current',hasValues:true,relation:'gt'},
 8:{label:'Battery Over Temperature',hasValues:true,relation:'gt',unit:'°C'},
 9:{label:'MOSFET Over Temperature',hasValues:true,relation:'gt'},
 10:{label:'System Alarm',hasValues:false},
 11:{label:'Battery Low Temperature',hasValues:true,relation:'lt'},
 12:{label:'Remote Control',hasValues:false},
 13:{label:'Above SoC',hasValues:true,relation:'gt'},
 14:{label:'MOSFET Abnormal',hasValues:false}
});
function dryRule(code){return DRY_TRIGGER_RULES[code] || null;}
function dryValidatePair(code,t,r){
 const rule=dryRule(code);
 if(!rule)return {ok:false,error:'dry_trigger_code_unsupported'};
 if(!rule.hasValues)return {ok:true};
 if(!Number.isInteger(t)||!Number.isInteger(r)||t< -2147483648||t>2147483647||r< -2147483648||r>2147483647)return {ok:false,error:'dry_threshold_invalid_int32'};
 // Coherence guard; equality is deliberately disallowed (no hysteresis).
 if(rule.relation==='gt'&&!(t>r))return {ok:false,error:'dry_trigger_must_be_greater_than_release'};
 if(rule.relation==='lt'&&!(t<r))return {ok:false,error:'dry_trigger_must_be_lower_than_release'};
 return {ok:true};
}

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
  else if(b[0]<=15&&b[1]===16)n=8;
  else if(b[0]<=15&&b[1]===0x90)n=5;
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
 send(addr,reg,value,quantity,expect,done,options={}){
  if(!this.ready||this.pending||this.closed)return false;
  const timeoutMs=Number.isFinite(Number(options.timeoutMs))&&Number(options.timeoutMs)>0
   ? Number(options.timeoutMs)
   : this.owner.timeoutMs;
  const resetOnTimeout=options.resetOnTimeout!==false;
  this.pending={addr,reg,quantity,expect,done};
  this.timer=setTimeout(()=>{
   if(resetOnTimeout){
    // Normal runtime behavior: close socket before any next transaction so
    // late replies cannot contaminate the following exchange.
    this.ready=false;this.socket.destroy();this.finish(new Error('response_timeout'));
   }else{
    // Discovery behavior: an absent address is expected, so keep the TCP
    // transport alive. A later frame for another address is rejected by the
    // pending address/register validation.
    this.buffer=Buffer.alloc(0);this.finish(new Error('response_timeout'));
   }
  },timeoutMs);
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
 send(addr,reg,value,quantity,expect,done,options={}){
  if(!this.ready||this.pending||this.closed||!this.port)return false;
  const frame=request(addr,reg,value,quantity);
  const timeoutMs=Number.isFinite(Number(options.timeoutMs))&&Number(options.timeoutMs)>0
   ? Number(options.timeoutMs)
   : this.owner.timeoutMs;
  const resetOnTimeout=options.resetOnTimeout!==false;
  this.pending={addr,reg,quantity,expect,done};this.lastTx=frame;
  this.timer=setTimeout(()=>{
   if(resetOnTimeout){
    // Normal runtime behavior, unchanged from v4.2.95.
    this.reset(new Error('response_timeout'));
   }else{
    // Discovery behavior: no BMS at this address is expected and must not
    // trigger a close/reopen cycle. Clear parser/echo state before continuing.
    this.buffer=Buffer.alloc(0);this.lastTx=null;this.finish(new Error('response_timeout'));
   }
  },timeoutMs);
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


const REGISTER_NAMES = Object.freeze({
  0x161c: 'STATIC',
  0x161e: 'SETUP',
  0x1620: 'LIVE'
});

function registerHex(reg){
  return '0x' + Number(reg).toString(16).toUpperCase().padStart(4,'0');
}

function registerName(reg, expect='frame'){
  if (REGISTER_NAMES[reg]) return REGISTER_NAMES[reg];
  return expect === 'ack' ? 'WRITE' : 'REGISTER';
}

function newExchangeStat(){
  return {
    attempts: 0,
    successes: 0,
    failures: 0,
    timeouts: 0,
    last_ms: null,
    avg_ms: null,
    max_ms: null,
    last_ok_at: null,
    last_error: null,
    last_error_at: null
  };
}

class Engine {
 constructor(config,emit,authorized){
  this.emit=emit;this.authorized=authorized;this.stopped=false;this.timeoutMs=config.timeoutMs||1000;this.intervalMs=config.intervalMs||3000;
  const configuredDiscoveryTimeout=Number(config.discoveryTimeoutMs);
  this.discoveryTimeoutMs=Number.isFinite(configuredDiscoveryTimeout)
   ? Math.max(100,Math.min(1000,configuredDiscoveryTimeout))
   : 250;
  // v4.2.93 - Real USB/RS485 validation showed normal replies around 42-47 ms,
  // with occasional completely missed transactions. Keep the response timeout
  // unchanged and add a conservative quiet time only between Serial requests.
  // TCP behavior remains exactly as before during normal runtime.
  const configuredGap=Number(config.serialInterFrameMs);
  this.serialInterFrameMs=Number.isFinite(configuredGap)?Math.max(0,configuredGap):100;
  this.states=new Map();this.frameMeta=new WeakMap();
  for(const d of config.packs){
   // Keep runtime discovery state private to the engine. The wrapper may reuse
   // the Node-RED config object when ap.start() is called again; mutating that
   // shared object would change the config signature and restart the engine.
   const runtimeDef={
    ...d,
    bms_addresses:Array.isArray(d.bms_addresses)?[...d.bms_addresses]:[]
   };
   const autoDiscovery=runtimeDef.bms_discovery==='auto'||runtimeDef.bms_addresses.length===0;
   const state={
    def:runtimeDef,bus:createBus(runtimeDef,this),due:[],commands:[],running:false,timer:null,lastError:null,
    lastLive:{},responses:0,exchangeStats:{},nextSerialTxAt:0,
    autoDiscovery,discoveryComplete:!autoDiscovery,discoveryRunning:false,
    discoveryRetryAt:0,discoveredBms:autoDiscovery?[]:[...runtimeDef.bms_addresses]
   };
   if(!autoDiscovery)this.populateDue(state,runtimeDef.bms_addresses);
   this.states.set(runtimeDef.id,state);state.bus.connect();
  }
 }
 populateDue(s,addresses){
  s.due=[];
  for(const addr of addresses)for(const reg of [0x161e,0x161c,0x1620])s.due.push({addr,reg,at:0});
 }
 connection(id,online){const s=this.states.get(id);if(!this.stopped)this.emit({event:'connection',pack_id:id,transport:s?.def?.transport,bus_id:s?.def?.bus_id,online});}
 error(id,error,extra={}){const s=this.states.get(id);if(!this.stopped)this.emit({event:'error',pack_id:id,transport:s?.def?.transport,bus_id:s?.def?.bus_id,error,...extra});}
 wake(id,delay=0){const s=this.states.get(id);if(!s||this.stopped)return;clearTimeout(s.timer);s.timer=setTimeout(()=>this.step(s),delay);}
 recordExchange(s,meta,ok,error=null){
  const bmsKey=`BMS_${meta.bms_numero}`;
  const regKey=meta.register_name+(meta.register_name==='WRITE'?`_${meta.register_hex}`:'');
  if(!s.exchangeStats[bmsKey])s.exchangeStats[bmsKey]={};
  const st=s.exchangeStats[bmsKey][regKey]||newExchangeStat();
  st.attempts++;
  if(ok){
   st.successes++;
   st.last_ms=meta.response_ms;
   st.max_ms=st.max_ms===null?meta.response_ms:Math.max(st.max_ms,meta.response_ms);
   st.avg_ms=st.avg_ms===null?meta.response_ms:Number((((st.avg_ms*(st.successes-1))+meta.response_ms)/st.successes).toFixed(1));
   st.last_ok_at=Date.now();
  }else{
   st.failures++;
   if(error==='response_timeout')st.timeouts++;
   st.last_error=error||'unknown';
   st.last_error_at=Date.now();
  }
  s.exchangeStats[bmsKey][regKey]=st;
 }
 publish(s,addr,reg,frame){
  if(this.stopped)return;
  const meta=this.frameMeta.get(frame)||{};
  if(frame&&typeof frame==='object')this.frameMeta.delete(frame);
  s.responses++;if(reg===0x1620)s.lastLive[addr]=Date.now();
  this.emit({event:'frame',pack_id:s.def.id,pack_name:s.def.name,bus_id:s.def.bus_id,_transport:s.def.transport,bms_numero:addr,register:reg,register_hex:registerHex(reg),register_name:registerName(reg),response_ms:meta.response_ms,timeout_ms:this.timeoutMs,payload:frame});
 }
 status(s,c,status,extra={}){if(this.stopped)return;this.emit({event:'command',pack_id:s.def.id,transport:s.def.transport,bus_id:s.def.bus_id,bms_numero:c.addr,control:c.control,status,command_id:c.id,requested_value:c.value,register:c.def.register,register_hex:registerHex(c.def.register),request_id:c.requestId||null,previous_value:c.previousValue,source_code:c.sourceCode,unit:c.unit||null,...extra});}
 command(pack,addr,control,value,retained,meta={}){
  const s=this.states.get(pack), def=CONTROL_DEFS[control];
  if(!s||!s.def.bms_addresses.includes(addr)||!def||retained||!this.authorized())return false;
  if(def.kind==='switch'||def.kind==='switch32'){
   if(typeof value!=='boolean')return false;
  }else{
   if(typeof value!=='number'||!Number.isFinite(value)||value<def.min||value>def.max)return false;
   if(def.integer===true&&!Number.isInteger(value))return false;
  }
  if(s.commands.length>=16)return false;
  if(def.dry && (s.activeDry===addr || s.commands.some(q=>q.addr===addr&&q.def.dry)))return false;
  if(meta.request_id!==undefined && (typeof meta.request_id!=='string'||!/^dry-[a-zA-Z0-9-]{8,100}$/.test(meta.request_id)))return false;
  if(meta.expected_raw!==undefined && !Number.isInteger(meta.expected_raw))return false;
  if(meta.expected_source!==undefined && (!Number.isInteger(meta.expected_source)||meta.expected_source<0||meta.expected_source>255))return false;
  const c={addr,control,value,def,id:Date.now().toString(36)+'-'+Math.random().toString(16).slice(2,8),expires:performance.now()+15000,requestId:meta.request_id,expectedRaw:meta.expected_raw,expectedSource:meta.expected_source};
  s.commands.push(c);this.status(s,c,'queued');this.wake(pack);return true;
 }
 async waitTransportGap(s){
  if(s.def.transport!=='serial'||this.serialInterFrameMs<=0)return;
  const remaining=s.nextSerialTxAt-performance.now();
  if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining));
 }
 async exchange(s,addr,reg,value=0,quantity=1,expect='frame',options={}){
  // The gap is measured from completion of the previous Serial transaction to
  // transmission of the next one. It remains outside response_ms.
  await this.waitTransportGap(s);
  const started=performance.now();
  const effectiveTimeout=Number.isFinite(Number(options.timeoutMs))&&Number(options.timeoutMs)>0
   ? Number(options.timeoutMs)
   : this.timeoutMs;
  const recordStats=options.recordStats!==false;
  if(options.beforeSend)options.beforeSend();
  const baseMeta={
   bms_numero:addr,register:reg,register_hex:registerHex(reg),
   register_name:registerName(reg,expect),expect,quantity,timeout_ms:effectiveTimeout
  };
  return new Promise((resolve,reject)=>{
   const done=(e,f)=>{
    const completed=performance.now();
    // Preserve the validated 100 ms Serial quiet time for discovery too.
    if(s.def.transport==='serial')s.nextSerialTxAt=completed+this.serialInterFrameMs;
    const meta={...baseMeta,response_ms:Number((completed-started).toFixed(1))};
    if(e){
     if(recordStats)this.recordExchange(s,meta,false,e.message);
     e.ap_meta=meta;
     reject(e);
    }else{
     if(recordStats)this.recordExchange(s,meta,true);
     if(f&&typeof f==='object')this.frameMeta.set(f,meta);
     resolve(f);
    }
   };
   const busOptions={
    timeoutMs:effectiveTimeout,
    resetOnTimeout:options.resetOnTimeout!==false
   };
   if(!s.bus.send(addr,reg,value,quantity,expect,done,busOptions)){
    const e=new Error('not_connected');
    const meta={...baseMeta,response_ms:Number((performance.now()-started).toFixed(1))};
    if(recordStats)this.recordExchange(s,meta,false,e.message);
    e.ap_meta=meta;
    reject(e);
   }
  });
 }

 async discover(s){
  if(this.stopped||!s.autoDiscovery||s.discoveryComplete||s.discoveryRunning||!s.bus.ready)return;
  const now=performance.now();
  if(now<s.discoveryRetryAt)return;

  s.discoveryRunning=true;
  const found=[];
  let transportLost=false;
  this.emit({
   event:'discovery',phase:'start',pack_id:s.def.id,pack_name:s.def.name,
   transport:s.def.transport,bus_id:s.def.bus_id,
   scan_from:0,scan_to:15,timeout_ms:this.discoveryTimeoutMs
  });

  try{
   for(let addr=0;addr<=15;addr++){
    if(this.stopped||!s.bus.ready){transportLost=true;break;}
    try{
     // SETUP is used because its validated frame contains the embedded device
     // address, giving an additional protection against false positives.
     const f=await this.exchange(
      s,addr,0x161e,0,1,'frame',
      {timeoutMs:this.discoveryTimeoutMs,resetOnTimeout:false,recordStats:false}
     );
     found.push(addr);
     const meta=this.frameMeta.get(f)||{};
     if(f&&typeof f==='object')this.frameMeta.delete(f);
     this.emit({
      event:'discovery',phase:'found',pack_id:s.def.id,pack_name:s.def.name,
      transport:s.def.transport,bus_id:s.def.bus_id,bms_numero:addr,
      response_ms:meta.response_ms,timeout_ms:this.discoveryTimeoutMs
     });
    }catch(e){
     // response_timeout is the normal "address not present" result during
     // discovery and must not become a runtime fault or warning.
     if(e.message==='not_connected'||e.message==='connection_closed'||e.message==='serial_error'){
      transportLost=true;break;
     }
     if(e.message!=='response_timeout'){
      this.emit({
       event:'discovery',phase:'probe_error',pack_id:s.def.id,pack_name:s.def.name,
       transport:s.def.transport,bus_id:s.def.bus_id,bms_numero:addr,
       error:e.message,timeout_ms:this.discoveryTimeoutMs
      });
     }
    }
   }

   if(transportLost){
    // Re-run after transport reconnection; do not publish an incomplete list.
    s.discoveryRetryAt=performance.now()+1000;
    return;
   }

   s.discoveredBms=[...found];
   s.def.bms_addresses=[...found];

   if(found.length){
    this.populateDue(s,found);
    s.discoveryComplete=true;
    s.discoveryRetryAt=0;
   }else{
    // No BMS at startup: keep the pack alive and retry later without flooding
    // the bus or Home Assistant logs.
    s.discoveryComplete=false;
    s.discoveryRetryAt=performance.now()+60000;
   }

   this.emit({
    event:'discovery',phase:'complete',pack_id:s.def.id,pack_name:s.def.name,
    transport:s.def.transport,bus_id:s.def.bus_id,
    discovered_bms:[...found],count:found.length,
    retry_ms:found.length?0:60000,timeout_ms:this.discoveryTimeoutMs
   });
  }finally{
   s.discoveryRunning=false;
  }
 }

 async step(s){
  if(this.stopped||s.running||!s.bus.ready)return;
  s.running=true;
  try {
   if(s.autoDiscovery&&!s.discoveryComplete){
    await this.discover(s);
    return;
   }
   const c=s.commands.shift();
   if(c){
    if(c.def.dry)s.activeDry=c.addr;
    try{
     if(performance.now()>c.expires)throw new Error('command_expired');
     if(!this.authorized())throw new Error('not_authorized');
     const staticControl=c.def.kind==='static_select'||c.def.kind==='static_number';
     // Existing controls are verified against SETUP (0x161E). DRY1/DRY2
     // configuration is verified against STATIC / Device Info (0x161C).
     const verifyReg=staticControl?0x161c:0x161e;
     const before=await this.exchange(s,c.addr,verifyReg);this.publish(s,c.addr,verifyReg,before);
     if(staticControl){
      if(this.stopped)throw new Error('stopped');
      c.previousValue=c.def.kind==='static_select'?before.readUInt8(c.def.offset):before.readInt32LE(c.def.offset);
      c.sourceCode=before.readUInt8(c.def.dry===1?235:236);
      c.unit=c.def.kind==='static_number'?(dryRule(c.sourceCode)?.unit||'brut'):'code';
      if(c.expectedRaw!==undefined&&c.expectedRaw!==c.previousValue)throw new Error('dry_value_changed');
      if(c.expectedSource!==undefined&&c.expectedSource!==c.sourceCode)throw new Error('dry_source_changed');
     }
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
     }else if(c.def.kind==='static_select'){
      const old=before.readUInt8(c.def.offset), desired=Number(c.value);

      // Before activating a threshold-based DRY source, validate the currently
      // staged Trigger/Release values. Safe workflow:
      //   source Off -> stage values -> select the final source.
      const triggerOffset=c.def.dry===1?246:254;
      const releaseOffset=c.def.dry===1?250:258;
      const pair=dryValidatePair(
       desired,
       before.readInt32LE(triggerOffset),
       before.readInt32LE(releaseOffset)
      );
      if(!pair.ok)throw new Error(pair.error);

      // 0x14E4 and 0x14E6 each contain two adjacent UINT8 fields. Preserve the
      // neighbouring byte with a read/modify/write so we never alter the LCD
      // buzzer source or the UART protocol library version.
      const neighbor=before.readUInt8(c.def.neighborOffset);
      const encoded=c.def.byte==='low'
       ? ((neighbor<<8)|desired)
       : ((desired<<8)|neighbor);

      if(this.stopped||!this.authorized()||performance.now()>c.expires)throw new Error('authorization_or_expiry');
      if(desired!==old){
       await this.exchange(s,c.addr,c.def.register,encoded,1,'ack',{beforeSend:()=>{if(this.stopped||!this.authorized()||performance.now()>c.expires)throw new Error('authorization_or_expiry');}});
       this.status(s,c,'acknowledged',{previous_value:old,encoded_value:encoded,source_frame:'STATIC'});
      }

      const after=await this.exchange(s,c.addr,0x161c);this.publish(s,c.addr,0x161c,after);
      const readback=after.readUInt8(c.def.offset);
      this.status(
       s,c,readback===desired && after.readUInt8(c.def.neighborOffset)===neighbor?'confirmed':'not_confirmed',
       {previous_value:old,readback_value:readback,encoded_value:encoded,neighbor_preserved:after.readUInt8(c.def.neighborOffset)===neighbor,source_frame:'STATIC'}
      );
     }else if(c.def.kind==='static_number'){
      const oldRaw=before.readInt32LE(c.def.offset), desiredRaw=Math.round(c.value);
      const sourceOffset=c.def.dry===1?235:236;
      const sourceCode=before.readUInt8(sourceOffset);
      const rule=dryRule(sourceCode);
      if(!rule)throw new Error('dry_trigger_code_unsupported');

      // For an active threshold-based source, keep Trigger/Release coherent.
      // If the source is Off/event-only, raw values may be staged first; the
      // final source selection above performs the pair validation.
      if(rule.hasValues){
       const triggerOffset=c.def.dry===1?246:254;
       const releaseOffset=c.def.dry===1?250:258;
       const triggerValue=c.def.role==='trigger'?desiredRaw:before.readInt32LE(triggerOffset);
       const releaseValue=c.def.role==='release'?desiredRaw:before.readInt32LE(releaseOffset);
       const pair=dryValidatePair(sourceCode,triggerValue,releaseValue);
       if(!pair.ok)throw new Error(pair.error);
      }

      if(!this.authorized()||performance.now()>c.expires)throw new Error('authorization_or_expiry');
      if(desiredRaw!==oldRaw){
       await this.exchange(s,c.addr,c.def.register,desiredRaw,2,'ack',{beforeSend:()=>{if(this.stopped||!this.authorized()||performance.now()>c.expires)throw new Error('authorization_or_expiry');}});
       this.status(s,c,'acknowledged',{previous_value:oldRaw,encoded_value:desiredRaw,source_frame:'STATIC'});
      }

      const after=await this.exchange(s,c.addr,0x161c);this.publish(s,c.addr,0x161c,after);
      const readbackRaw=after.readInt32LE(c.def.offset);
      this.status(
       s,c,readbackRaw===desiredRaw && after.readUInt8(sourceOffset)===sourceCode?'confirmed':'not_confirmed',
       {previous_value:oldRaw,readback_value:readbackRaw,encoded_value:desiredRaw,source_frame:'STATIC'}
      );
     }else{
      const oldRaw=before.readInt32LE(c.def.offset), oldValue=oldRaw/c.def.scale;
      const desiredRaw=Math.round(c.value*c.def.scale), desiredValue=desiredRaw/c.def.scale;
      if(!this.authorized()||performance.now()>c.expires)throw new Error('authorization_or_expiry');
      if(desiredRaw!==oldRaw){await this.exchange(s,c.addr,c.def.register,desiredRaw,2,'ack');this.status(s,c,'acknowledged',{previous_value:oldValue,encoded_value:desiredRaw});}
      const after=await this.exchange(s,c.addr,0x161e);this.publish(s,c.addr,0x161e,after);
      const readbackRaw=after.readInt32LE(c.def.offset), readbackValue=readbackRaw/c.def.scale;
      this.status(s,c,readbackRaw===desiredRaw?'confirmed':'not_confirmed',{previous_value:oldValue,readback_value:readbackValue,encoded_value:desiredRaw,normalized_value:desiredValue});
     }
    }catch(e){
     const meta=e.ap_meta||{};
     this.status(s,c,'failed',{error:e.message,...meta});
     if(e.message==='response_timeout')this.error(s.def.id,e.message,{...meta,phase:'command',control:c.control});
    }finally{if(c.def.dry)s.activeDry=null;}
   }else{
    s.due.sort((a,b)=>a.at-b.at);
    const job=s.due[0];
    if(job.at>performance.now())return;
    job.at=performance.now()+(job.reg===0x1620?this.intervalMs:job.reg===0x161e?20000:60000);
    try{const f=await this.exchange(s,job.addr,job.reg);this.publish(s,job.addr,job.reg,f);}catch(e){
     const meta=e.ap_meta||{bms_numero:job.addr,register:job.reg,register_hex:registerHex(job.reg),register_name:registerName(job.reg),timeout_ms:this.timeoutMs};
     this.error(s.def.id,e.message,{...meta,phase:'poll'});
    }
   }
  }finally{
   s.running=false;
   if(!this.stopped){
    const next=s.commands.length
     ? 25
     : (s.due.length
        ? Math.max(25,Math.min(...s.due.map(j=>j.at))-performance.now())
        : Math.max(25,s.discoveryRetryAt-performance.now()));
    this.wake(s.def.id,Math.min(Math.max(25,next),1000));
   }
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
  const autoDiscovery=p.bms_discovery==='auto'||(Array.isArray(p.bms_addresses)&&p.bms_addresses.length===0);
  if(autoDiscovery){
   p.bms_discovery='auto';
   if(!Array.isArray(p.bms_addresses))p.bms_addresses=[];
  }else if(!Array.isArray(p.bms_addresses)||!p.bms_addresses.length||p.bms_addresses.some(a=>!Number.isInteger(a)||a<0||a>15)||new Set(p.bms_addresses).size!==p.bms_addresses.length){
   throw new Error('Invalid manual BMS addresses');
  }
 }
}
module.exports={crc,packet,request,parse,CONTROL_DEFS,DRY_TRIGGER_RULES,dryValidatePair,Engine,validate,
 start(id,config,emit,authorized){validate(config);const signature=JSON.stringify(config);const old=runtimes.get(id);if(old&&old.signature===signature)return;this.stop(id);const engine=new Engine(config,emit,authorized);runtimes.set(id,{engine,signature});},
 snapshot(id){const r=runtimes.get(id);if(!r)return [];return [...r.engine.states.values()].map(s=>({event:'health',pack_id:s.def.id,transport:s.def.transport,bus_id:s.def.bus_id,endpoint:s.def.transport==='serial'?s.def.path:`${s.def.host}:${s.def.port}`,connected:s.bus.ready,configured_bms:s.def.bms_addresses,discovery_mode:s.autoDiscovery?'auto':'manual',discovery_complete:s.discoveryComplete,discovered_bms:[...s.discoveredBms],last_live_ms:{...s.lastLive},validated_responses:s.responses,queued_commands:s.commands.length,timeout_ms:r.engine.timeoutMs,serial_inter_frame_ms:s.def.transport==='serial'?r.engine.serialInterFrameMs:0,response_stats:JSON.parse(JSON.stringify(s.exchangeStats))}));},
 command(id,...args){const r=runtimes.get(id);return r?r.engine.command(...args):false;},
 stop(id){const r=runtimes.get(id);if(r){r.engine.stop();runtimes.delete(id);}}
};
