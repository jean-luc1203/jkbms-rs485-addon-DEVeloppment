'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const root='rootfs/etc/smartphoton_jkbms_multipack/www/';
const scada=fs.readFileSync(root+'scada/index.html','utf8');
const glow=fs.readFileSync(root+'glow/index.html','utf8');
const s=scada.match(/<script>([\s\S]*?)<\/script>/)?.[1];
const g=glow.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(s&&g,'Dashboard scripts missing');
new vm.Script(s,{filename:'scada/index.html'});
new vm.Script(g,{filename:'glow/index.html'});

// Real SCADA operator renderers, without modifying the HA transport.
const pack={id:'pack_2',name:'Pack 2 - Berlin',members:['1','2'],bms:2,
  online:false,hasData:true,soc:86,power:1880,a:35.4,v:53.21,d:8,t:24,ageSec:100};
const bms={soc:85,power:920,a:17.34,v:53.21,d:8,t:24,mos:24,t1:22.8,t2:23,
  balance:0,ageSec:100,alarm:false,charge:true,discharge:true,balancing:false,
  soh:100,remaining:238,nominal:280,status:'CHARGE'};
const dom={};
const ctx={
  currentPacks:[pack],readBms:()=>bms,spView:v=>v,
  spScadaOffline:key=>({missing:'Mesures instantanées indisponibles',
    history:'Dernières valeurs enregistrées (historiques)',state:'État BMS indisponible'})[key]||key,
  document:{getElementById:id=>(dom[id]??=( {textContent:'',innerHTML:''} ))},
  freshnessLabel:()=> '100 s',freshnessClass:()=> 'bad',
  showScadaDetail:()=>{},packIssues:()=>[],spScadaText:v=>v,
  boolState:(label,on,live)=>label+': '+(live?(on?'ACTIF':'INACTIF'):'—')
};
function slice(a,b){const i=s.indexOf(a),j=s.indexOf(b,i+a.length);
  assert.ok(i>=0&&j>i,'Missing SCADA code: '+a);return s.slice(i,j);}
const packFn=vm.runInNewContext(slice('function openPack(id){','function boolState(label,on)')+'\nopenPack',ctx);
packFn('pack_2');
const offPack=dom.detailBody.innerHTML;
assert.match(offPack,/PACK OFFLINE/);
assert.match(offPack,/Mesures instantanées indisponibles/);
assert.doesNotMatch(offPack,/1\.88 kW|86%|53\.21 V/);
assert.match(offPack,/Pack 2 - Berlin|BMS 1/);

const bmsFn=vm.runInNewContext(slice('function openBms(packId,bms){','function openBmsOverview()')+'\nopenBms',ctx);
bmsFn('pack_2','1');
const offBms=dom.detailBody.innerHTML;
assert.match(offBms,/État BMS indisponible/);
assert.match(offBms,/Dernières valeurs enregistrées/);
assert.doesNotMatch(offBms,/0\.92 kW|85%|17\.34 A|ACTIVE<\/b>|AUCUNE<\/b>/);
assert.match(offBms,/MOS charge/);
assert.match(offBms,/—/);

// A genuinely live reading — including zero — must remain visible.
pack.online=true;
pack.power=0;
pack.a=0;
packFn('pack_2');
assert.match(dom.detailBody.innerHTML,/0\.00 kW/);
assert.match(dom.detailBody.innerHTML,/86%/);
bmsFn('pack_2','1');
assert.match(dom.detailBody.innerHTML,/0\.92 kW/);
assert.match(dom.detailBody.innerHTML,/85%/);
assert.match(dom.detailBody.innerHTML,/NORMAL/);

const cardFn=vm.runInNewContext(slice('function packHTML(p){','let currentPacks=[]')+'\npackHTML',
  {freshnessClass:()=> 'bad',freshnessLabel:()=> '100 s'});
pack.online=false;
const offCard=cardFn(pack);
assert.match(offCard,/OFFLINE/);
assert.doesNotMatch(offCard,/86%|53\.21 V/);

// Offline Glow must not advertise an old charge/discharge direction as live.
assert.match(g,/offline=!b\.online, stale=isStale\(b\)\|\|offline/);
assert.match(g,/offline\?\`<span class="pill off">\$\{spGlowOfflineUi\('past'\)\}/);
assert.match(s,/SP_SCADA_OFFLINE_UI/);
assert.match(s,/p\.online===false\?'—'/);
assert.match(s,/Source : entités JK-BMS Home Assistant en temps réel/);

const cfg=fs.readFileSync('config.yaml','utf8');
assert.match(cfg,/^version: 1\.0\.0-dev79\.5$/m);
const flows=JSON.parse(fs.readFileSync('rootfs/etc/node-red/flows.json','utf8'));
for(const [id,slug] of [['34cada0000000002','scada'],['74a0000000000002','glow']]){
  assert.ok(flows.find(x=>x.id===id)?.func.includes(slug+'/index.html?v=dev79-5'));
}
console.log('PASS dev79-5-scada-glow-offline-operator.test.cjs');
