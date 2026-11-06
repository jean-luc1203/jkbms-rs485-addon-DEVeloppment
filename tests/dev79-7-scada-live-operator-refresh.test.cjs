'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const root='rootfs/etc/smartphoton_jkbms_multipack/www/';
const html=fs.readFileSync(root+'scada/index.html','utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script,'SCADA script missing');
new vm.Script(script,{filename:'scada/index.html'});
const glow=fs.readFileSync(root+'glow/index.html','utf8');
new vm.Script(glow.match(/<script>([\s\S]*?)<\/script>/)?.[1],{filename:'glow/index.html'});

const start=script.indexOf('let scadaOperatorView=null;');
const end=script.indexOf('const SP_SCADA_VIEW_LABELS=',start);
assert.ok(start>0&&end>start,'Live operator helper missing');
const helper=script.slice(start,end);

const pack={id:'pack_2',name:'Pack 2 - Berlin',members:['1','2'],bms:2,
 online:true,hasData:true,soc:86,power:1880,a:35,v:53.21,d:8,t:24,ageSec:0.6};
const other={id:'pack_1',name:'Pack 1 - RS485-1',members:['0','2'],bms:2,online:true,hasData:true,
 soc:53,power:-750,a:-15,v:52.1,d:5,t:22,ageSec:0.5};
const bms={soc:85,power:920,a:17.34,v:53.2,d:8,t:24,
 mos:24,t1:22.8,t2:23,balance:0,remaining:238,nominal:280,soh:100,
 charge:true,discharge:true,balancing:false,alarm:false,status:'CHARGE',ageSec:0.7};
const overlay={open:false,classList:{contains:()=>overlay.open,add:()=>{overlay.open=true}},
 querySelector:()=>panel};
const panel={scrollTop:0};
let confirmationOpen=false;
const confirmLayer={classList:{contains:()=>confirmationOpen}};
let rendered=[],htmlInside='';
const ctx={
 currentPacks:[pack,other],
 readBms:(id,b)=>id==='pack_2'?{...bms,bms:String(b)}:null,
 spLanguage:'de',
 document:{getElementById:id=>id==='scadaOverlay'?overlay:id==='controlConfirmLayer'?confirmLayer:null},
 currentControlContext:null,currentParameterContext:null,
};
const api=vm.runInNewContext(helper+'\n({show:showScadaDetail,refresh:scadaRefreshOperatorLive,language:scadaRefreshOperatorLanguage,signature:scadaOperatorSignature,age:scadaOperatorAgeBucket})',ctx);
ctx.openBms=(id,address)=>{
 rendered.push(['bms',id,String(address),pack.online,bms.soc,bms.power]);
 htmlInside=pack.online?'Live '+bms.soc+' % / '+bms.power+' W':'Pack offline —';
 api.show(false,{kind:'bms',packId:id,bms:address});
};
ctx.openPack=id=>{
 rendered.push(['pack',id,pack.online,pack.soc]);
 htmlInside=pack.online?'Live '+pack.soc+' %':'Pack offline —';
 api.show(false,{kind:'pack',packId:id});
};
const count=()=>rendered.length;

api.show(false,{kind:'bms',packId:'pack_2',bms:'1'});
panel.scrollTop=123;
api.refresh();
assert.equal(count(),1,'Initial view should be rendered exactly once');
assert.match(htmlInside,/85 %/);
assert.equal(panel.scrollTop,123,'BMS refresh must preserve scroll');
api.refresh();
assert.equal(count(),1,'Unchanged BMS must not rebuild DOM each second');

other.soc=61;
api.refresh();
assert.equal(count(),1,'Changes to another pack cannot rebuild selected BMS');

pack.online=false;
pack.ageSec=65;
bms.ageSec=65;
api.refresh();
assert.equal(count(),2,'Online to offline must refresh the same open BMS');
assert.match(htmlInside,/offline —/);
assert.deepEqual(rendered.at(-1).slice(0,3),['bms','pack_2','1']);
assert.equal(panel.scrollTop,123);

bms.ageSec=67;
api.refresh();
assert.equal(count(),2,'Avoid rebuilding HTML solely for every second of age');
bms.ageSec=70;
api.refresh();
assert.equal(count(),3,'Refresh historical data age in bounded buckets');

// Critical incident: Berlin reconnects while BMS view remains open.
pack.online=true;
pack.ageSec=0.4;
bms.ageSec=0.5;
bms.soc=86;
bms.power=970;
api.refresh();
assert.equal(count(),4,'Recovery must repaint the already-open BMS without Ctrl+F5');
assert.match(htmlInside,/Live 86 % \/ 970 W/);
assert.deepEqual(rendered.at(-1).slice(0,3),['bms','pack_2','1']);
assert.equal(panel.scrollTop,123);

bms.power=0;
api.refresh();
assert.equal(count(),5,'Real zero is a live measurement and must update');
assert.match(htmlInside,/0 W/);

// The same functionality must work with an open pack view.
api.show(false,{kind:'pack',packId:'pack_2'});
panel.scrollTop=86;
api.refresh();
const initialPackPaint=count();
pack.online=false;
api.refresh();
assert.equal(count(),initialPackPaint+1,'Pack view must repaint on communication loss');
pack.online=true;pack.soc=87;
api.refresh();
assert.equal(count(),initialPackPaint+2,'Pack view must repaint on reconnect');
assert.equal(panel.scrollTop,86,'Pack view must preserve scroll');

// Neither a command workspace nor confirmation modal may be auto-replaced.
ctx.currentControlContext={packId:'pack_2',bms:'1'};
pack.online=false;
api.refresh();
assert.equal(count(),initialPackPaint+2,'Never refresh command workspace');
ctx.currentControlContext=null;
confirmationOpen=true;
api.refresh();
assert.equal(count(),initialPackPaint+2,'Never replace an open confirmation dialog');
confirmationOpen=false;
ctx.currentParameterContext={packId:'pack_2',bms:'1'};
api.refresh();
assert.equal(count(),initialPackPaint+2,'Never refresh technical parameter editing');
ctx.currentParameterContext=null;
api.refresh();
assert.equal(count(),initialPackPaint+3,'Refresh once controls are no longer active');

// Language change must keep the same operator view, not restart a command.
panel.scrollTop=46;
api.language();
assert.equal(rendered.at(-1)[0],'pack');
assert.equal(panel.scrollTop,46);

// Other overlays do not carry the read-only operator context.
api.show(false,null);
const old=count();
pack.soc=34;
api.refresh();
assert.equal(count(),old,'No refresh for alarms, audit, settings or other overlays');

// Verify the recurring HA render actually invokes the read-only refresh.
assert.match(script,/function render\(\)[\s\S]*?scadaRefreshOperatorLive\(\);\s*\}/);
assert.match(script,/if\(!v\|\|!overlay\?\.classList\.contains\('open'\)/);

const cfg=fs.readFileSync('config.yaml','utf8');
assert.match(cfg,/^version: 1\.0\.0-dev79\.7$/m);
const flows=JSON.parse(fs.readFileSync('rootfs/etc/node-red/flows.json','utf8'));
for(const [id,name] of [['34cada0000000002','scada'],['74a0000000000002','glow']]){
 const node=flows.find(x=>x.id===id);
 assert.ok(node&&node.func.includes(name+'/index.html?v=dev79-7'),'Stale '+name+' cache version');
}
console.log('PASS dev79-7-scada-live-operator-refresh.test.cjs');
