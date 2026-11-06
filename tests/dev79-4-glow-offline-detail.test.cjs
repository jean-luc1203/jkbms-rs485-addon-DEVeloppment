'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const file='rootfs/etc/smartphoton_jkbms_multipack/www/glow/index.html';
const html=fs.readFileSync(file,'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script,'Glow script missing');
new vm.Script(script,{filename:'glow/index.html'});

// Execute the real detailed pack renderer with a controlled HA pack state.
const i=script.indexOf('const SP_GLOW_OFFLINE_UI=');
const j=script.indexOf('function paramDiffs(p,b)',i);
assert.ok(i>0&&j>i,'Offline i18n and pagePack block missing');
let active=false;
const data={online:false,power:0,soc:0,current:0,voltage:0,temp:0,delta:0,
  capRem:0,capNom:0,balancing:false,alarms:[],ts:Date.now()-120000};
const env={
  spLanguage:'fr', S:{range:'24h',expanded:new Set()},
  TH:{socCrit:20,deltaWarn:20,deltaCrit:50,tempWarn:40,tempCrit:50},
  agg:()=>({...data,online:active}),
  stateL:()=>active?'ok':'off',
  autonomy:()=>({ic:'⏳',v:'0 h 00',sub:'au repos'}),
  header:(_crumb,title,pills)=>'<h1>'+title+'</h1>'+pills,
  esc:v=>String(v), stTxt:{off:'Hors ligne',ok:'Normal'},
  fresh:()=> 'il y a 2 min',
  kpi:(title,value,sub)=>'<article data-kpi="'+title+'"><b>'+value+'</b><small>'+(sub||'')+'</small></article>',
  socKpi:(soc)=>'<article data-kpi="SOC">'+soc+' %</article>',
  pw:v=>v+' W',
  f:(v,d=0)=>Number(v).toFixed(d),
  flowTxt:()=>['Au repos','idle'],
  dL:()=> 'ok', tL:()=> 'ok',
  chart:()=>'', series:()=>null, rangeSeg:()=>'', 
  trendHtml:()=>'', ago:()=>null,
  spGlowBmsUi:k=>k,spGlowLabel:k=>k,spGlowCard:k=>k,spGlowOverview:k=>k,spGlowDetail:k=>k,
  cellsBlock:()=>'', compareView:()=>'<div>comparison</div>'
};
const render=vm.runInNewContext(script.slice(i,j)+'\npagePack',env);
const pack={id:2,name:'Pack 2 - Berlin',bms:[],link:'TCP'};
const off=render(pack,'live');
assert.match(off,/Pack 2 - Berlin/);
assert.match(off,/Pack hors ligne — mesures instantanées indisponibles/);
assert.match(off,/Les valeurs BMS et les courbes ci-dessous sont historiques/);
assert.match(off,/Dernières valeurs enregistrées/);
assert.match(off,/>—<\/b>/);
assert.equal((off.match(/data-kpi=/g)||[]).length,8);
assert.equal((off.match(/<b>—<\/b>/g)||[]).length,8,
  'All eight instant KPI measurements must be unavailable');
assert.doesNotMatch(off,/0\.00\s*V|0\.0\s*A|0\s*W|0\s*%/,
  'Do not fabricate zero-valued live pack measurements');

active=true;
data.power=1250;data.soc=86;data.voltage=53.21;data.current=23.5;data.temp=24;data.delta=8;
const live=render(pack,'live');
assert.doesNotMatch(live,/Pack hors ligne — mesures instantanées indisponibles/);
assert.match(live,/1250 W/);
assert.match(live,/86 %/);
assert.match(live,/53\.21/);

// Genuine zeros are retained when an online BMS actually reports zero.
data.power=0;data.soc=0;data.current=0;
const zero=render(pack,'live');
assert.match(zero,/0 W/);
assert.match(zero,/0 %/);
assert.doesNotMatch(zero,/Mesure indisponible/);

const comp=script.slice(script.indexOf('function pageAggregation()'),script.indexOf('function packSeries('));
assert.match(comp,/bms\.filter\(b=>b\.online\)/,
  'Offline cell temperatures must not influence fleet extreme measurements');
assert.match(comp,/rows\.filter\(r=>r\.a\.online\)/,
  'Offline packs must not win the best-pack ranking');
assert.match(comp,/a\.online\?pw\(a\.power\)/,
  'Offline power comparisons must show an unavailable value');

const wall=script.slice(script.indexOf('function pageWall()'),script.indexOf('function pageSettings()'));
assert.match(wall,/a\.online\?f\(a\.soc,0\)/);
assert.match(wall,/a\.online\?autonomy\(/);

const cards=script.slice(script.indexOf('function packCard(p)'),script.indexOf('function pageOverview()'));
assert.match(cards,/a\.online\?f\(a\.voltage,2\)/);
assert.match(cards,/!a\.online\?'—'/);

const compare=script.slice(script.indexOf('function compareView(p)'),script.indexOf('function cellsBlock('));
assert.match(compare,/b\.online\?fn\(b\):'—'/);

const flow=JSON.parse(fs.readFileSync('rootfs/etc/node-red/flows.json','utf8'));
const cfg=fs.readFileSync('config.yaml','utf8');
assert.match(cfg,/^version: 1\.0\.0-dev79\.4$/m);
for(const [id,target] of [['74a0000000000002','glow'],['34cada0000000002','scada']]){
  const node=flow.find(n=>n.id===id);
  assert.ok(node,'Dashboard sidebar generator missing '+id);
  assert.ok(node.func.includes(target+'/index.html?v=dev79-4'),
    'Stale dashboard iframe cache tag for '+target);
}
console.log('PASS dev79-4-glow-offline-detail.test.cjs');
