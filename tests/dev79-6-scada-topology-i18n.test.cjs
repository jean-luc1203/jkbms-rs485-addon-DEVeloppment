'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const root='rootfs/etc/smartphoton_jkbms_multipack/www/';
const html=fs.readFileSync(root+'scada/index.html','utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script,'SCADA JavaScript missing');
new vm.Script(script,{filename:'scada/index.html'});
const glow=fs.readFileSync(root+'glow/index.html','utf8');
new vm.Script(glow.match(/<script>([\s\S]*?)<\/script>/)?.[1],{filename:'glow/index.html'});

function section(start,end){
 const i=script.indexOf(start),j=script.indexOf(end,i+start.length);
 assert.ok(i>=0&&j>i,'Missing source section: '+start);
 return script.slice(i,j);
}
const topologySrc=section('const SCADA_TOPOLOGY_KEY=', 'function readCells(packId,bms){');
const storageData=new Map();
const storage={
 getItem:key=>storageData.get(key)??null,
 setItem:(key,value)=>storageData.set(key,String(value))
};
const meta={state:'48.5',attributes:{pack_names:{pack_2:'Pack 2 - Berlin'},pack_transports:{pack_2:'tcp'}}};
const h={states:{}};
function topologySession(localStore=storage,age=135){
 return vm.runInNewContext(topologySrc+'\n({restore:scadaRestoreTopology,valid:scadaMemberIds})',
 {localStorage:localStore,packHeartbeatAge:()=>age});
}
const online={id:'pack_2',name:'Pack 2 - Berlin',members:['1','2'],bms:2,
 online:true,hasData:true,soc:85,power:1867.8,v:53.215,a:35,ageSec:3};
let session=topologySession();
const reported=session.restore([online],meta,h)[0];
assert.deepEqual(Array.from(reported.members),['1','2']);
assert.equal(reported.topologySource,'summary');
assert.equal(reported.bms,2);
assert.ok(storageData.has('smartphoton_scada_known_bms_v1'));

const missing={...online,online:false,members:[],bms:0,ageSec:17};
const restored=session.restore([missing],meta,h)[0];
assert.deepEqual(Array.from(restored.members),['1','2']);
assert.equal(restored.topologySource,'last_known');
assert.equal(restored.bms,2);
assert.equal(restored.ageSec,135,'Use physical BMS age, not refreshed HA summary timestamp');

session=topologySession(); // page reload while Berlin remains offline
const reloaded=session.restore([missing],meta,h)[0];
assert.deepEqual(Array.from(reloaded.members),['1','2']);
assert.equal(reloaded.topologySource,'last_known');
assert.deepEqual(Array.from(session.valid(['0','2','2','16','-1','xyz'])),['0','2'],
 'Preserve real master address 0, never invent out-of-range addresses');

const changed={...meta,attributes:{pack_names:{pack_2:'New site'},pack_transports:{pack_2:'serial'}}};
const unrelated=session.restore([{...missing,name:'New site'}],changed,h)[0];
assert.equal(unrelated.topologySource,'unknown');
assert.equal(unrelated.members.length,0,'Do not reuse last-known BMS after pack identity changes');
const freshStore={getItem:()=>null,setItem:()=>{}};
const neverSeen=topologySession(freshStore).restore([{...missing,bms:2}],meta,h)[0];
assert.equal(neverSeen.members.length,0,'Never invent BMS 1,2 from bms_count=2');
assert.equal(neverSeen.topologySource,'unknown');

// A republished summary timestamp cannot make physical BMS telemetry look new.
const ageSrc=section('function packHeartbeatAge(', 'function freshnessClass(');
const ageFn=vm.runInNewContext(ageSrc+'\npackHeartbeatAge',{memberHeartbeatAge:()=>null});
assert.equal(ageFn(h,'pack_2',[],{last_updated:new Date().toISOString()}),null);
assert.equal(ageFn(h,'pack_2',['1','2'],{last_updated:new Date().toISOString()}),null);
assert.match(script,/packs=scadaRestoreTopology\(packs,glob,h\)/);

// Localizations and operator banner — preserve a clear title/body separation.
const i18nSrc=section('const SP_SCADA_OFFLINE_UI=', 'function openPack(id){');
const context={spLanguage:'fr',freshnessLabel:()=> '135 s'};
const tr=vm.runInNewContext(i18nSrc+'\n({label:spScadaOffline,caption:scadaTopologyCaption,notice:scadaOfflineNotice})',context);
assert.match(tr.caption(restored),/2 BMS connus/);
assert.doesNotMatch(tr.caption(neverSeen),/^0 BMS/);
assert.match(tr.notice(135),/<b>Mesures instantanées indisponibles<\/b><span class="notice-detail">/);
context.spLanguage='en';
assert.match(tr.caption(restored),/known BMS/);
assert.match(tr.notice(null),/Live measurements unavailable/);
context.spLanguage='de';
assert.match(tr.label('state'),/BMS-Zustand nicht verfügbar/);
assert.match(tr.caption(neverSeen),/BMS-Topologie/);
assert.match(tr.notice(135),/Aktuelle Messwerte nicht verfügbar/);

// Operator overlays must neutralize offline SOC and re-render on language change.
assert.match(script,/class="detail-soc \$\{p\.online===false\|\|!visible\?'offline'/);
assert.match(script,/class="detail-soc \$\{!live\?'offline'/);
assert.match(html,/\.detail-soc\.offline\{background:/);
assert.match(script,/showScadaDetail\(false,\{kind:'pack',packId:id\}\)/);
assert.match(script,/showScadaDetail\(false,\{kind:'bms',packId,bms\}\)/);
assert.match(script,/spSetLanguage\(value\)[\s\S]*?scadaRefreshOperatorLanguage\(\)/);
assert.match(script,/scadaRefreshOperatorLanguage\(\);spApplyLanguage\(\)/);

// Refresh only the active operator overlay, preserve scroll; do not send commands.
const refreshSrc=section('function scadaRefreshOperatorLanguage(){','function showScadaDetail(');
let invoked=[];
const panel={scrollTop:87};
const layer={classList:{contains:()=>true},querySelector:()=>panel};
const rEnv={
 scadaOperatorView:{kind:'bms',packId:'pack_2',bms:'1'},
 document:{getElementById:id=>id==='scadaOverlay'?layer:id==='controlConfirmLayer'?{classList:{contains:()=>false}}:null},
 openBms:(p,b)=>invoked.push(['bms',p,b]),openPack:p=>invoked.push(['pack',p])
};
const refresh=vm.runInNewContext(refreshSrc+'\nscadaRefreshOperatorLanguage',rEnv);
refresh();
assert.deepEqual(invoked,[['bms','pack_2','1']]);
assert.equal(panel.scrollTop,87);
rEnv.scadaOperatorView={kind:'pack',packId:'pack_2'};
refresh();
assert.deepEqual(invoked[1],['pack','pack_2']);

const cfg=fs.readFileSync('config.yaml','utf8');
const version=cfg.match(/^version:\s*1\.0\.0-(dev\d+\.\d+)$/m)?.[1];
assert.ok(version,'DEV version missing');
const cacheTag=version.replace('.','-');
const flows=JSON.parse(fs.readFileSync('rootfs/etc/node-red/flows.json','utf8'));
for(const [id,name] of [['34cada0000000002','scada'],['74a0000000000002','glow']]){
 const node=flows.find(x=>x.id===id);
 assert.ok(node,'Missing dashboard menu node '+id);
 assert.ok(node.func.includes(name+'/index.html?v='+cacheTag),'Stale cache tag for '+name);
}
console.log('PASS dev79-6-scada-topology-i18n.test.cjs');
