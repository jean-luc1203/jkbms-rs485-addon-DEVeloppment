'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const root = 'rootfs/etc/smartphoton_jkbms_multipack/www/';
const scada = fs.readFileSync(root+'scada/index.html','utf8');
const glow = fs.readFileSync(root+'glow/index.html','utf8');
const scadaJs = scada.match(/<script>([\s\S]*?)<\/script>/)?.[1];
const glowJs = glow.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(scadaJs && glowJs, 'Both dashboards must embed JavaScript');
new vm.Script(scadaJs,{filename:'scada/index.html'});
new vm.Script(glowJs,{filename:'glow/index.html'});

const flows=JSON.parse(fs.readFileSync('rootfs/etc/node-red/flows.json','utf8'));
const bridge=flows.find(n=>n.id==='13b6b22d1a8e5c40');
assert.ok(bridge,'HA multi-pack discovery bridge missing');
assert.match(bridge.func,/pack_names:meta\.names/);
assert.match(bridge.func,/pack_transports:meta\.transports/);
assert.match(bridge.func,/safePackMeta\(\)/);
assert.match(bridge.func,/names:Object\.fromEntries\(packIds\.map/);
assert.match(bridge.func,/transports:Object\.fromEntries\(packIds\.map/);
const menuScada=flows.find(n=>n.name==='BUILD SMARTPHOTON SCADA MENU (dev66)');
const menuGlow=flows.find(n=>n.name==='BUILD SMARTPHOTON GLOW MENU (dev74)');
assert.ok(menuScada && menuGlow);
assert.match(menuScada.func,/scada\/index\.html\?v=dev79-3/);
assert.match(menuGlow.func,/glow\/index\.html\?v=dev79-3/);

// A true zero is a valid measurement; a null/unavailable value is not.
const i=scadaJs.indexOf('function finite(v)');
const j=scadaJs.indexOf('// DEV79.1:',i);
assert.ok(i>=0&&j>i,'SCADA reading helper section missing');
const fns=vm.runInNewContext(
  scadaJs.slice(i,j)+
  '\n({finite,livePack})',
  {packSummary: id=>'sensor.'+id+'_summary'}
);
assert.equal(fns.finite(0),0);
assert.equal(fns.finite('0'),0);
for(const bad of [null,undefined,'','unknown','unavailable','none']){
  assert.equal(fns.finite(bad),null,'Absent value must not become a numeric zero: '+String(bad));
}
const globalState={state:'75.0',attributes:{
  configured_pack_ids:['pack_1','pack_2'],
  pack_names:{pack_1:'Pack 1 - RS485-1',pack_2:'Pack 2 - Berlin'},
  pack_transports:{pack_1:'serial',pack_2:'tcp'}
}};
const h={states:{
  'sensor.pack_2_summary':{state:'unavailable',attributes:{soc_pct:null,power_total_w:null,voltage_v:null},last_updated:'2026-11-05T19:00:00Z'}
}};
const missing=fns.livePack(h,'pack_2',globalState);
assert.equal(missing.name,'Pack 2 - Berlin');
assert.equal(missing.hasData,false);
assert.equal(missing.online,false);
const noEntity=fns.livePack({states:{}},'pack_2',globalState);
assert.equal(noEntity.name,'Pack 2 - Berlin');
assert.equal(noEntity.hasData,false);

const start=scadaJs.indexOf('function packHTML(p)');
const stop=scadaJs.indexOf('let currentPacks=[]',start);
assert.ok(start>0&&stop>start,'SCADA pack card section missing');
const html=vm.runInNewContext(
  scadaJs.slice(start,stop)+'\npackHTML',
  {freshnessClass:()=> 'bad',freshnessLabel:()=> '—'}
)(missing);
assert.match(html,/Pack 2 - Berlin/);
assert.match(html,/MESURES INDISPONIBLES/);
assert.doesNotMatch(html,/>0%<\/b>/);
assert.doesNotMatch(html,/>0\.00 V<\/b>/);
assert.match(html,/>—<\/b>/);
assert.match(scadaJs,/const visible=p\.hasData!==false;const display=/);

assert.match(glowJs,/function spGlowOfflineHelp\(p\)/);
assert.match(glowJs,/pack_transports/);
assert.match(glowJs,/Vérifier la connexion TCP\/IP et la passerelle/);
assert.match(glowJs,/a\.online\?f\(a\.soc,0\)\+' %':'—'/);
assert.match(glowJs,/a\.online\?f\(a\.temp,1\)\+' °C':'—'/);
assert.match(glowJs,/a\.online\?f\(a\.delta,0\)\+' mV':'—'/);
const cfg=fs.readFileSync('config.yaml','utf8');
assert.match(cfg,/^version: 1\.0\.0-dev79\.3$/m);
console.log('PASS dev79-3-offline-metadata-and-diagnostics.test.cjs');
