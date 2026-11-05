'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('rootfs/etc/smartphoton_jkbms_multipack/www/scada/index.html','utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'SCADA script must exist');
new vm.Script(script, {filename:'scada/index.html'});
const start=script.indexOf('function scadaResolvePackAvailability(');
const end=script.indexOf('\nfunction readBms(',start);
assert.ok(start>0 && end>start,'Pure pack availability helper missing');
const resolve=vm.runInNewContext(script.slice(start,end)+'\nscadaResolvePackAvailability');
const packs=[
 {id:'pack_1',online:true,ageSec:85,power:0},
 {id:'pack_2',online:true,ageSec:43,power:1880}
];
const globalStatus=(on,off)=>({state:'62.5',attributes:{online_packs:on,offline_packs:off}});
const diag={state:'PACK_OFFLINE',attributes:{active_issues:[{code:'PACK_OFFLINE',packs:['pack_2']}]}};
const outage=resolve(packs,globalStatus(['pack_1'],['pack_2']),diag);
assert.equal(outage[0].online,true,'Pack 1 remains online despite its unchanged HA values');
assert.equal(outage[1].online,false,'Pack 2 must be OFFLINE despite retained numeric summary');
assert.equal(outage.filter(p=>p.online!==false).length,1);
assert.equal(outage.filter(p=>p.online!==false).reduce((n,p)=>n+p.power,0),0);
const recovered=resolve(packs,globalStatus(['pack_1','pack_2'],[]),{state:'OK',attributes:{active_issues:[]}});
assert.equal(recovered.filter(p=>p.online!==false).length,2);
const diagFallback=resolve(packs,{state:'unavailable'},diag);
assert.equal(diagFallback[0].online,true);
assert.equal(diagFallback[1].online,false);
const unchanged=resolve(packs,{state:'unavailable'},{state:'unavailable'});
assert.equal(unchanged[0].online,true);
assert.equal(unchanged[1].online,true);

// Visible UI, summary and local alarm center must share the resolved pack status.
assert.match(script,/packs=scadaResolvePackAvailability\(packs,glob,diag\);\s*currentPacks=packs;\s*const scadaIssues=syncAlarmState\(\);/);
assert.match(script,/const online=packs.filter\(p=>p.online!==false\).length;/);
assert.match(script,/if\(p.online===false\)push\('PACK_OFFLINE'/);
assert.match(script,/const activePacks=packs.filter\(p=>p.online!==false\);/);
assert.match(html,/\.pack\.off\{opacity:1;filter:none;border-color:/);
assert.match(html,/offline-label/);
assert.match(script,/DERNIÈRE MAJ HA/);
assert.doesNotMatch(script,/members\.map\(\(\)=>'<i class="bms-dot on"><\/i>'\)/);
console.log('PASS dev79-1-scada-pack-offline-status.test.cjs');
