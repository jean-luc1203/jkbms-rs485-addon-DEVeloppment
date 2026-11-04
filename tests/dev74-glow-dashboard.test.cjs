'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root,'rootfs/etc/smartphoton_jkbms_multipack/www/glow/index.html'),'utf8');
const match = html.match(/<script>([\s\S]*?)<\/script>/);
assert(match,'Glow script missing');
new vm.Script(match[1],{filename:'Glow'});
const js = match[1].split('/* Démarrage */')[0].replace('function render(){','function render(){ return;');
const noop=()=>{};
const el={addEventListener:noop,classList:{toggle:noop},style:{},dataset:{},innerHTML:''};
const ctx=vm.createContext({
  console,Date,Math,Promise,URLSearchParams,setInterval:noop,addEventListener:noop,
  document:{addEventListener:noop,getElementById:()=>el,querySelector:()=>null},
  window:{},location:{hash:'',search:''},
  localStorage:{getItem:()=>null,setItem:noop,removeItem:noop},
  matchMedia:()=>({matches:false}),scrollTo:noop,navigator:{},getSelection:noop
});
vm.runInContext(js,ctx,{timeout:10000});
const state=(pack,bms)=>({entity_id:`sensor.pack_${pack}_bms_${bms}_tension_totale_volt`,state:'52.5',last_updated:new Date().toISOString(),attributes:{}});
function run(states,hash=''){
  ctx.location.hash=hash;
  vm.runInContext('S.autoRouteApplied=false;',ctx);
  ctx.buildFromStates(states);
  return ctx.location.hash;
}
assert.equal(run([state(1,0),state(1,2)]),'#/pack/1/bms/0/live');
const topology=(ids)=>({entity_id:'sensor.smartphoton_jk_bms_multi_pack_global_summary',state:'47',attributes:{configured_pack_ids:ids}});
const stale={...state(2,1),state:'unavailable'};
assert.equal(run([state(1,0),state(1,2),state(2,1),state(3,1),state(4,1),topology(['pack_1'])]),
  '#/pack/1/bms/0/live','removed packs must not block mono-pack routing');
assert.equal(vm.runInContext('PACKS.map(p=>p.id).join(",")',ctx),'1');
assert.equal(run([state(1,0),stale,topology(['pack_1','pack_2'])]),'',
  'configured offline pack must remain present on fleet overview');
assert.equal(vm.runInContext('PACKS.map(p=>p.id).join(",")',ctx),'1,2');
assert.equal(run([state(1,0),state(2,1),state(3,1),topology(['pack_1'])],'#/pack/1/bms/2/params'),
  '#/pack/1/bms/2/params','explicit navigation must stay untouched');
assert.equal(run([state(1,0),state(2,1),state(3,1)],''),'',
  'without topology, wait rather than redirect when several HA packs exist');
vm.runInContext("applyHaEventState({entity_id:GLOBAL_SUMMARY_ID,state:'47',attributes:{configured_pack_ids:['pack_1']}})",ctx);
assert.equal(ctx.location.hash,'#/pack/1/bms/0/live',
  'topology received after initial HA state list must activate mono-pack route');
assert.equal(vm.runInContext('PACKS.length',ctx),1);

assert.equal(run([state(1,2),state(1,0)]),'#/pack/1/bms/0/live'); // BMS triés par adresse
assert.equal(run([state(1,2),state(1,3)],'#/pack/1'),'#/pack/1'); // navigation explicite préservée
assert.equal(run([state(1,0),state(1,2)],'#/pack/1/bms/2/params'),'#/pack/1/bms/2/params'); // BMS et onglet explicites
assert.equal(vm.runInContext('PACKS[0].bms.map(b=>b.id).join(",")',ctx),'0,2');
assert.equal(run([state(1,0)]),'#/pack/1/bms/0/live');
assert.equal(run([state(1,0),state(2,3)]),'');
assert.equal(run([state(2,4),state(1,0)]),''); // multi-pack : vue générale conservée
assert.equal(run([state(1,0)],'#/settings'),'#/settings');
run([]);
assert.equal(vm.runInContext('S.mode',ctx),'waiting');
assert.equal(vm.runInContext('PACKS.length',ctx),0);
assert(match[1].includes("new URLSearchParams(location.search).get('demo')==='1'"));
assert(!match[1].includes('b.params[x.k]=x.v'));
assert(!match[1].includes('b.switches[x.k]=x.v'));

const flows=JSON.parse(fs.readFileSync(path.join(root,'rootfs/etc/node-red/flows.json'),'utf8'));
assert.equal(flows.length,449);
assert.equal(flows.filter(n=>n.type==='function').length,105);
const inject=flows.find(n=>n.id==='13b6b22d1a8e5d01');
assert(inject.wires[0].includes('34cada0000000002'));
assert(inject.wires[0].includes('74a0000000000002'));
const glow=flows.find(n=>n.id==='74a0000000000002');
assert(glow.func.includes('premium.multi_pack_premium_available'));
const runMenu=(get)=>vm.runInNewContext(`(function(msg){${glow.func}})(msg)`,{
  msg:{},global:{get},node:{status:noop,warn:noop}
});
const allowed=runMenu(k=>({
  'premium.runtime_mode':'multi_pack',
  'premium.multi_pack_premium_available':true,
  'premium.features':{dashboard_premium:true}
})[k]);
assert.equal(allowed[0].filename,'/config/dashboards/smart_jkbms_glow.json');
assert.equal(JSON.parse(allowed[0].payload).dashboard_meta.url_path,'smart-jkbms-glow');
const denied=runMenu(k=>({'premium.runtime_mode':'legacy','premium.features':{dashboard_premium:true}})[k]);
assert.equal(denied[0],null);
assert.equal(denied[1].filename,'/config/dashboards/smart_jkbms_glow.json');
console.log('DEV77 Glow single-pack BMS startup, explicit routes, multi-pack overview, Premium gating: PASS');
