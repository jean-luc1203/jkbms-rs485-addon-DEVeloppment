'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'../rootfs/etc/smartphoton_jkbms_multipack/www/glow/journal.js'),'utf8');
let receive;
let language='fr';
const S={mode:'ha',hass:{connection:{subscribeMessage:(cb,opts)=>{
  assert.equal(opts.topic,'jkbms/glow/journal/snapshot');
  receive=cb;return Promise.resolve(()=>{});
}}}};
const ctx={
 S,location:{hash:'#/journal'},document:{addEventListener:()=>{}},
 window:{addEventListener:()=>{}},setInterval:()=>0,setTimeout:()=>1,clearTimeout:()=>{},
 pageJournal:()=>'',pageBms:()=>'',render:()=>{},PACKS:[
 {id:1,name:'Pack 1 - RS485-1'},{id:2,name:'Pack 2 - Berlin'}],
 spLocale:()=>language==='de'?'de-DE':language==='en'?'en-GB':'fr-FR',
 spGlowLabel:x=>x,spGlowView:x=>x,header:()=>'',esc:x=>String(x),
 Date,JSON,Array,Set,String,Number,console
};
Object.defineProperty(ctx,'spLanguage',{get(){return language}});
vm.runInNewContext(code,ctx,{filename:'journal.js'});
const mqtt={
 topic:'jkbms/glow/journal/snapshot',retain:true,
 payload:JSON.stringify({schema_version:1,source:'node_red',events:[
 {id:'a',t:1793627979231,cat:'alarm',lvl:'warn',pack:'pack_1',bms:null,
  txt:'CELL_DELTA_HIGH active',
  det:'Pack 1 - RS485-1 has an internal cell delta of 73 mV.'},
 {id:'b',t:1793596007144,cat:'alarm',lvl:'warn',pack:'pack_2',bms:null,
  txt:'TEMPERATURE_HIGH active',det:'Pack 2 - Berlin reached 55 °C.'},
 {id:'c',t:1793262322785,cat:'param',lvl:'info',pack:'pack_1',bms:'0',
  txt:'BMS command: LCD toujours allumé',det:'confirmed'}
]})
};
receive(mqtt);
const before=mqtt.payload;
const expected={
 fr:['Écart de tension des cellules — déclenchée','Température élevée — déclenchée','Commande BMS: LCD toujours allumé','présente un écart de tension interne de 73 mV'],
 en:['Cell voltage difference — active','High temperature — active','BMS command: LCD toujours allumé','has an internal cell delta of 73 mV'],
 de:['Zellspannungsdifferenz — ausgelöst','Hohe Temperatur — ausgelöst','BMS-Befehl: LCD toujours allumé','hat eine interne Zellspannungsdifferenz von 73 mV']
};
for(const loc of ['fr','en','de']){
 language=loc;
 const page=ctx.pageJournal();
 for(const label of expected[loc])assert.ok(page.includes(label),loc+': missing '+label);
 assert.equal((page.match(/<small>Pack 1 - RS485-1(?: ·|<\/small>)/g)||[]).length,2,'pack label must appear once in each event row, excluding the filter option in '+loc);
 assert.match(page,/\b02\/11 \d{2}:59\b/,'unambiguous date/time without locale punctuation');
 assert.match(page,/min-width:180px/);
 assert.match(page,/color:#edf4ff!important/);
 assert.match(page,/min-width:175px/);
 assert.ok(!page.includes('02.11.,'),'no extra German punctuation');
}
assert.equal(mqtt.payload,before,'presentation must never mutate retained MQTT JSON');
console.log('PASS dev76-1-glow-journal-ui.test.cjs');
