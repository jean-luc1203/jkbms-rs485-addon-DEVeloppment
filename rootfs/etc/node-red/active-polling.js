'use strict';
// Independent TCP RTU engine. No Legacy globals, no shared slave counter.
const net = require('net');
const {performance} = require('perf_hooks');
const runtimes = new Map();
function crc(b) { let c=65535; for(const v of b){c^=v;for(let i=0;i<8;i++)c=c&1?(c>>>1)^0xa001:c>>>1;}return c; }
function packet(b){return Buffer.concat([b,Buffer.from([crc(b)&255,crc(b)>>>8])]);}
function request(a,r,v=0){return packet(Buffer.from([a,16,r>>>8,r&255,0,1,2,v>>>8,v&255]));}
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
class Bus {
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
    if(tail[1]!==16||tail.readUInt16BE(2)!==p.reg||tail.readUInt16BE(4)!==1)continue;
    if(p.reg===0x1114&&f.length!==8)continue;
    if(p.reg!==0x1114){
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
 send(addr,reg,value,done){
  if(!this.ready||this.pending||this.closed)return false;
  this.pending={addr,reg,done};
  this.timer=setTimeout(()=>{ // close socket before any next transaction: quarantine late replies
   this.ready=false;this.socket.destroy();this.finish(new Error('response_timeout'));
  },this.owner.timeoutMs);
  this.socket.write(request(addr,reg,value));return true;
 }
 stop(){this.closed=true;clearTimeout(this.retry);clearTimeout(this.connectionTimer);clearTimeout(this.timer);this.ready=false;this.finish(new Error("stopped"));if(this.socket)this.socket.destroy();}
}
class Engine {
 constructor(config,emit,authorized){
  this.emit=emit;this.authorized=authorized;this.stopped=false;this.timeoutMs=config.timeoutMs||1000;this.intervalMs=config.intervalMs||3000;this.states=new Map();
  for(const d of config.packs){
   const state={def:d,bus:new Bus(d,this),due:[],commands:[],running:false,timer:null,lastError:null,lastLive:{},responses:0};
   for(const addr of d.bms_addresses)for(const reg of [0x161e,0x161c,0x1620])state.due.push({addr,reg,at:0});
   this.states.set(d.id,state);state.bus.connect();
  }
 }
 connection(id,online){if(!this.stopped)this.emit({event:'connection',pack_id:id,online});}
 error(id,error){if(!this.stopped)this.emit({event:'error',pack_id:id,error});}
 wake(id,delay=0){const s=this.states.get(id);if(!s||this.stopped)return;clearTimeout(s.timer);s.timer=setTimeout(()=>this.step(s),delay);}
 publish(s,addr,reg,frame){if(this.stopped)return;s.responses++;if(reg===0x1620)s.lastLive[addr]=Date.now();this.emit({event:'frame',pack_id:s.def.id,pack_name:s.def.name,bus_id:s.def.bus_id,_transport:'tcp',bms_numero:addr,register:reg,payload:frame});}
 status(s,c,status,extra={}){if(this.stopped)return;this.emit({event:'command',pack_id:s.def.id,bms_numero:c.addr,control:c.control,status,command_id:c.id,...extra});}
 command(pack,addr,control,value,retained){
  const s=this.states.get(pack);
  if(!s||!s.def.bms_addresses.includes(addr)||!['display_always_on_switch','heating_switch'].includes(control)||typeof value!=='boolean'||retained||!this.authorized())return false;
  if(s.commands.length>=16)return false;
  const c={addr,control,value,id:Date.now().toString(36)+'-'+Math.random().toString(16).slice(2,8),expires:performance.now()+15000};
  s.commands.push(c);this.status(s,c,'queued');this.wake(pack);return true;
 }
 async exchange(s,addr,reg,value=0){return new Promise((resolve,reject)=>{if(!s.bus.send(addr,reg,value,(e,f)=>e?reject(e):resolve(f)))reject(new Error('not_connected'));});}
 async step(s){
  if(this.stopped||s.running||!s.bus.ready)return;
  s.running=true;
  try {
   const c=s.commands.shift();
   if(c){
    try{
     if(performance.now()>c.expires)throw new Error('command_expired');
     if(!this.authorized())throw new Error('not_authorized');
     // Fresh read/modify/write, same BMS, exclusive per-bus transaction group.
     const before=await this.exchange(s,c.addr,0x161e);this.publish(s,c.addr,0x161e,before);
     const mask=c.control==='heating_switch'?1:16;
     const old=before.readUInt16LE(282);const desired=c.value?old|mask:old&~mask;
     if(!this.authorized()||performance.now()>c.expires)throw new Error('authorization_or_expiry');
     if(desired!==old){await this.exchange(s,c.addr,0x1114,desired);this.status(s,c,'acknowledged');}
     const after=await this.exchange(s,c.addr,0x161e);this.publish(s,c.addr,0x161e,after);
     this.status(s,c,Boolean(after.readUInt16LE(282)&mask)===c.value?'confirmed':'not_confirmed');
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
 const endpoints=new Set(),ids=new Set();
 for(const p of config.packs){
  if(!/^pack_[1-5]$/.test(p.id)||ids.has(p.id)||p.transport!=='tcp'||typeof p.host!=='string'||!p.host||!Number.isInteger(p.port)||p.port<1||p.port>65535)throw new Error('Invalid TCP pack');
  const endpoint=p.host.toLowerCase()+':'+p.port;if(endpoints.has(endpoint))throw new Error('Duplicate endpoint');endpoints.add(endpoint);ids.add(p.id);
  if(!Array.isArray(p.bms_addresses)||!p.bms_addresses.length||p.bms_addresses.some(a=>!Number.isInteger(a)||a<1||a>15)||new Set(p.bms_addresses).size!==p.bms_addresses.length)throw new Error('Explicit BMS addresses required');
 }
}
module.exports={crc,packet,request,parse,Engine,validate,
 start(id,config,emit,authorized){validate(config);const signature=JSON.stringify(config);const old=runtimes.get(id);if(old&&old.signature===signature)return;this.stop(id);const engine=new Engine(config,emit,authorized);runtimes.set(id,{engine,signature});},
 snapshot(id){const r=runtimes.get(id);if(!r)return [];return [...r.engine.states.values()].map(s=>({event:'health',pack_id:s.def.id,connected:s.bus.ready,configured_bms:s.def.bms_addresses,last_live_ms:{...s.lastLive},validated_responses:s.responses,queued_commands:s.commands.length}));},
 command(id,...args){const r=runtimes.get(id);return r?r.engine.command(...args):false;},
 stop(id){const r=runtimes.get(id);if(r){r.engine.stop();runtimes.delete(id);}}
};
