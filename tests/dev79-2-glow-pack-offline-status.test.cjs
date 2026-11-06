'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('rootfs/etc/smartphoton_jkbms_multipack/www/glow/index.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'Glow inline script missing');
new vm.Script(script, {filename:'glow/index.html'});

const start = script.indexOf("const GLOBAL_SUMMARY_ID = ");
const stop = script.indexOf("function configuredPackIdsFromStates(", start);
assert.ok(start > 0 && stop > start, 'Glow connectivity helpers missing');

const packs=[
  {id:1, name:'Pack 1 - RS485-1', bms:[{id:0, online:true, haVoltageOnline:true},{id:2, online:true, haVoltageOnline:true}]},
  {id:2, name:'Pack 2 - Berlin', bms:[{id:1, online:true, haVoltageOnline:true},{id:2, online:true, haVoltageOnline:true}]}
];
const GLOBAL = 'sensor.smartphoton_jk_bms_multi_pack_global_summary';
const DIAG = 'sensor.smartphoton_jk_bms_multi_pack_diagnostics';
const ha = {mode:'ha', lastStateMap:new Map()};
const ctx = {Map, Set, S:ha, PACKS:packs};
const helpers = vm.runInNewContext(script.slice(start,stop)+'\n({glowResolvePackConnectivity,syncGlowPackConnectivity})',ctx);
const {glowResolvePackConnectivity:resolve,syncGlowPackConnectivity:sync} = helpers;

function globalState(online,offline){
  return {entity_id:GLOBAL,state:'80.0',attributes:{online_packs:online,offline_packs:offline,configured_pack_ids:['pack_1','pack_2']}};
}

// Normal state: no pack is marked offline.
ha.lastStateMap.set(GLOBAL,globalState(['pack_1','pack_2'],[]));
sync();
assert.equal(packs[0].communicating,true);
assert.equal(packs[1].communicating,true);
assert.ok(packs.flatMap(p=>p.bms).every(b=>b.online));

// Berlin failure: voltage entities still report retained numeric readings.
ha.lastStateMap.set(GLOBAL,globalState(['pack_1'],['pack_2']));
sync();
assert.equal(packs[0].communicating,true);
assert.equal(packs[1].communicating,false);
assert.ok(packs[0].bms.every(b=>b.online), 'Physical RS485-1 pack stays online');
assert.ok(packs[1].bms.every(b=>!b.online), 'All Berlin BMS are offline');
assert.equal(packs.filter(p=>p.communicating!==false).length,1);

// A retained successful voltage state must not override the pack outage.
packs[1].bms.forEach(b=>{b.haVoltageOnline=true;});
sync();
assert.ok(packs[1].bms.every(b=>!b.online));

// Automatic recovery: no new per-BMS voltage event is required.
ha.lastStateMap.set(GLOBAL,globalState(['pack_1','pack_2'],[]));
sync();
assert.ok(packs[1].bms.every(b=>b.online));
assert.equal(packs.filter(p=>p.communicating!==false).length,2);

// A genuine unavailable voltage still means offline, even if pack is globally online.
packs[0].bms[0].haVoltageOnline=false;
sync();
assert.equal(packs[0].bms[0].online,false);
assert.equal(packs[0].bms[1].online,true);
packs[0].bms[0].haVoltageOnline=true;

// Older HA installations: prefer diagnostic PACK_OFFLINE when global lists are unavailable.
const fallback = new Map([
  [GLOBAL,{state:'unavailable',attributes:{}}],
  [DIAG,{state:'PACK_OFFLINE',attributes:{active_issues:[{code:'PACK_OFFLINE',packs:['pack_2']}]}}]
]);
assert.equal(resolve(fallback).get('pack_2'),false);
ha.lastStateMap=fallback;
sync();
assert.equal(packs[1].communicating,false);
assert.equal(packs[0].communicating,null);
assert.ok(packs[0].bms.every(b=>b.online));

// No authoritative source: preserve legacy voltage-based availability.
ha.lastStateMap=new Map();
sync();
assert.equal(packs[1].communicating,null);
assert.ok(packs.flatMap(p=>p.bms).every(b=>b.online));

// Event updates must resynchronize immediately, not only on initial page load.
assert.match(script, /if\(s\.entity_id===GLOBAL_SUMMARY_ID\)\{[\s\S]*?syncGlowPackConnectivity\(\);\s*S\.dirty=true;\s*return;/);
assert.match(script, /if\(s\.entity_id===GLOW_DIAGNOSTICS_ID\)\{syncGlowPackConnectivity\(\);S\.dirty=true;return;\}/);
assert.match(script, /if\(applyState\(s\)\)\{syncGlowPackConnectivity\(\);S\.dirty=true;\}/);
assert.match(script, /states\.forEach\(applyState\);\s*syncGlowPackConnectivity\(\);/);

// The interface must neither call an offline pack online nor count its retained measurements.
assert.match(script, /if\(p\.communicating===false\) out\.push\(\{lvl:'crit'/);
assert.match(script, /const on = list\.filter\(b=>b\.online\)/);
assert.match(script, /const live=ag\.filter\(x=>x\.a\.online&&!x\.a\.stale\)\.length/);
assert.match(script, /PACK OFFLINE · DONNÉES FIGÉES/);
assert.match(script, /HORS LIGNE/);
assert.match(script, /const active=ag\.filter\(x=>x\.a\.online\)/);

const flows=JSON.parse(fs.readFileSync('rootfs/etc/node-red/flows.json','utf8'));
const menu=flows.find(n=>n.name==='BUILD SMARTPHOTON GLOW MENU (dev74)');
assert.ok(menu, 'Glow sidebar generator missing');
// The cache-busting URL must follow the add-on version. Avoid hardcoding
// the previous DEV tag, which would make every subsequent release fail.
const config = fs.readFileSync('config.yaml','utf8');
const version = config.match(/^version:\s*1\.0\.0-(dev\d+\.\d+)$/m)?.[1];
assert.ok(version, 'Expected a DEV add-on version in config.yaml');
const cacheTag = version.replace('.', '-');
assert.ok(menu.func.includes(`/glow/index.html?v=${cacheTag}`),
  `Glow iframe cache tag must match ${version} (v=${cacheTag})`);

console.log('PASS dev79-2-glow-pack-offline-status.test.cjs');
