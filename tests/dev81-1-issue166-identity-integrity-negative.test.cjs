'use strict';
// DEV81.1 issue #166 — RED tests: against untouched DEV81.0 these MUST fail.
// No physical BMS, HA instance, broker or TCP connection is accessed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const flows = JSON.parse(fs.readFileSync('rootfs/etc/node-red/flows.json','utf8'));
const byName = new Map(flows.map(n=>[n.name,n]));
function store(initial={}) {
 const d=new Map(Object.entries(initial));
 return {get:k=>d.get(k),set:(k,v)=>d.set(k,v),data:d};
}
function run(name,msg,opts={}) {
 const n=byName.get(name);
 assert.ok(n&&n.type==='function','missing Node-RED function '+name);
 const flow=opts.flow||store(),context=opts.context||store();
 const global=opts.global||store({
  multi_pack_enabled:true,bms_broadcasting:true,
  jkbms_active_polling_enabled:false,communication_debug:false,
  jkbms_pack_defs:{
   pack_1:{transport:'tcp',host:'192.0.2.11',port:8887,bus_id:'tcp_8887'},
   pack_2:{transport:'tcp',host:'192.0.2.12',port:5022,bus_id:'tcp_5022'}
  }
 });
 const messages=[],warnings=[],errors=[];
 const node={id:n.id,name:n.name,warn:m=>warnings.push(String(m)),
  error:m=>errors.push(String(m)),debug:()=>{},log:()=>{},
  send:m=>messages.push(m),status:()=>{}};
 const fn=new Function('msg','node','flow','context','global','Buffer',n.func);
 return {output:fn(msg,node,flow,context,global,Buffer),flow,context,global,messages,warnings,errors};
}
function frame(type,address,options={}) {
 const b=Buffer.alloc(options.noAck?300:308);
 b.set([0x55,0xaa,0xeb,0x90,type],0);
 if(type===1)b.writeUInt32LE(options.setupId??address,270);
 let sum=0;for(let i=0;i<299;i++)sum=(sum+b[i])&255;b[299]=sum;
 if(!options.noAck) {
  b.set([options.ackAddress??address,0x10,0x16,type===1?0x1e:0x20,0,1],300);
  let crc=0xffff;
  for(let i=300;i<306;i++){crc^=b[i];for(let k=0;k<8;k++)
   crc=(crc&1)?((crc>>>1)^0xa001):(crc>>>1);}
  b[306]=crc&255;b[307]=(crc>>>8)&255;
 }
 if(options.corruptChecksum)b[299]^=1;
 if(options.corruptCrc&&!options.noAck)b[307]^=1;
 return b;
}
function packet(bytes,pack='pack_1') {
 const bus=pack==='pack_1'?'tcp_8887':'tcp_5022';
 return {payload:{topic:'broadcast/jkbms_reply',payload:bytes,
  pack_id:pack,pack_name:pack,bus_id:bus,_transport:'tcp',slave:5},
  pack_id:pack,bus_id:bus,_transport:'tcp'};
}
function allMsgs(value) {
 if(!value)return [];
 if(Array.isArray(value))return value.flatMap(allMsgs);
 return typeof value==='object'?[value]:[];
}
function test() {
 const context=store(),flow=store();
 // Response identity must come from this frame, never a subsequent SETUP.
 let data=allMsgs(run('Type trames + adresse modbus',packet(frame(2,2)),{flow,context}).output);
 assert.equal(data.length,1,'valid 308 DATA requires immediate direct output');
 assert.equal(data[0].bms_numero,2);
 assert.equal(data[0].pack_id,'pack_1');
 assert.equal(data[0].bus_id,'tcp_8887');
 let setup=allMsgs(run('Type trames + adresse modbus',packet(frame(1,0)),{flow,context}).output);
 assert.equal(setup.length,1,'next SETUP must not flush a previous DATA');
 assert.equal(setup[0].bms_numero,0,'master address canonical 0');
 data=allMsgs(run('Type trames + adresse modbus',packet(frame(2,2),'pack_2'),{flow,context}).output);
 assert.equal(data.length,1,'same BMS address in pack_2 must be independent');
 assert.equal(data[0].pack_id,'pack_2');
 assert.equal(data[0].bus_id,'tcp_5022');

 for(const [label,b] of [
  ['bad JK checksum',frame(2,2,{corruptChecksum:true})],
  ['bad Modbus CRC',frame(2,2,{corruptCrc:true})],
  ['SETUP mismatched inner address',frame(1,2,{setupId:0})],
  ['address outside 0..15',frame(2,2,{ackAddress:255})],
  ['DATA without independent ACK identity',frame(2,2,{noAck:true})]
 ])assert.equal(allMsgs(run('Type trames + adresse modbus',packet(b),{flow,context}).output).length,0,label+' must not publish');
 let forged=packet(frame(2,2),'pack_2');forged.pack_id='pack_1';
 assert.equal(allMsgs(run('Type trames + adresse modbus',forged,{flow,context}).output).length,0,
  'conflicting pack provenance must be refused');
 for(const name of ['Data To MQTT','Setup To MQTT','TRAITEMENT DES ALARMES']) {
  for(const invalid of [undefined,null,'',NaN,'NaN',-488,327680,16,1.5,'2.5','ghost']) {
   const p={bms_numero:invalid,pack_id:'pack_2',bus_id:'tcp_5022',_transport:'tcp',
    payload:{error_code:0},pack_name:'Berlin'};
   const out=run(name,p);
   assert.equal(allMsgs(out.output).length+out.messages.flatMap(allMsgs).length,0,
    name+' accepted unverified identity '+String(invalid));
  }
  assert.equal(allMsgs(run(name,{bms_numero:2,bus_id:'tcp_5022',_transport:'tcp',
   payload:{error_code:0}}).output).length,0,name+' invents pack_1 origin');
 }
 for(let i=2;i<=5;i++){
  const name='Pack '+i+' watchdog check';
  const def={transport:'tcp',host:'192.0.2.'+i,port:5000+i,bus_id:'tcp_'+(5000+i)};
  const global=store({multi_pack_enabled:true,bms_broadcasting:true,
   jkbms_active_polling_enabled:false,jkbms_pack_defs:{['pack_'+i]:def}});
  const lastKey='lastDataTs_pack_'+i;
  let x=run(name,{}, {global,flow:store({[lastKey]:Date.now()-130000})}).output;
  assert.ok(Array.isArray(x)&&x[0].action==='close',name+' must use tcp-client2 close');
  assert.equal(x[0].port,5000+i,'must only close own pack transport');
  global.set('jkbms_active_polling_enabled',true);
  x=run(name,{}, {global,flow:store({[lastKey]:Date.now()-130000})}).output;
  assert.equal(x,null,name+' must not interrupt Active Polling');
 }
 console.log('PASS dev81-1-issue166-identity-integrity-negative.test.cjs');
}
test();
