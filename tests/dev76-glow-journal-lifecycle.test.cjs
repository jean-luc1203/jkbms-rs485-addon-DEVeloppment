'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../rootfs/etc/smartphoton_jkbms_multipack/www/glow/journal.js'),'utf8');
let renders=0, nextTimer=1;
const timeouts=new Map(),intervals=[];
const listeners={};
const document={addEventListener:(type,cb)=>{listeners[type]=cb}};
const window={addEventListener:(type,cb)=>{listeners['window:'+type]=cb}};
function connection(){
 const callbacks=[],subscriptions=[],closed=[];
 return {
  callbacks,subscriptions,closed,
  subscribeMessage(cb,options){
   callbacks.push(cb);subscriptions.push(options);
   return Promise.resolve(()=>closed.push(cb));
  }
 };
}
const first=connection();
const S={mode:'ha',hass:{connection:first}};
const ctx={
 S,document,window,location:{hash:'#/journal'},console,
 setInterval:(cb,ms)=>{intervals.push({cb,ms});return intervals.length},
 setTimeout:(cb,ms)=>{const id=nextTimer++;timeouts.set(id,{cb,ms});return id},
 clearTimeout:id=>timeouts.delete(id),
 pageJournal:()=>'',pageBms:()=>'',render:()=>{renders++},
 PACKS:[],spLanguage:'fr',spLocale:()=> 'fr-FR',spGlowLabel:s=>s,
 spGlowView:s=>s,header:()=>'',esc:s=>s,bmsKey:b=>b.id,
 Date,JSON,Array,Set,String,Number
};
vm.runInNewContext(source,ctx,{filename:'journal.js'});
const tick=async()=>{await Promise.resolve();await Promise.resolve()};
const assertUnavail=()=>assert.match(ctx.pageJournal(),/Journal indisponible/);
const snap=events=>({topic:'jkbms/glow/journal/snapshot',payload:JSON.stringify({
 schema_version:1,source:'node_red',events
})});
(async()=>{
 await tick();
 assert.equal(first.callbacks.length,1,'initial journal subscription');
 assert.equal(first.subscriptions[0].type,'mqtt/subscribe');
 assert.match(ctx.pageJournal(),/Chargement du journal/);
 const timer=[...timeouts.values()][0];
 assert.equal(timer.ms,12000);
 timer.cb();timeouts.clear();
 assertUnavail();
 assert.doesNotMatch(ctx.pageJournal(),/0 événements enregistrés/);
 first.callbacks[0](snap([{id:'one',t:Date.now(),pack:'pack_1',bms:'0',cat:'alarm',txt:'Real alarm'}]));
 assert.match(ctx.pageJournal(),/Real alarm/,'late snapshot must recover after timeout');
 // A manual refresh must drop the prior rows; callbacks from that subscription are stale.
 listeners.click({target:{closest:s=>s==='[data-dev76-refresh]'?{}:null}});
 await tick();
 assert.equal(first.callbacks.length,2);
 assert.doesNotMatch(ctx.pageJournal(),/Real alarm/);
 first.callbacks[0](snap([{id:'old',t:Date.now(),txt:'Old stale event'}]));
 assert.doesNotMatch(ctx.pageJournal(),/Old stale event/);
 first.callbacks[1](snap([]));
 assert.match(ctx.pageJournal(),/Aucun événement pour ces filtres/,'empty valid snapshot is distinct from unavailable');
 const second=connection();
 S.hass.connection=second;
 const periodic=intervals.find(x=>x.ms===30000);
 periodic.cb();
 await tick();
 assert.equal(second.callbacks.length,1,'new HA connection resubscribes');
 assert.match(ctx.pageJournal(),/Chargement du journal/,'new HA connection must wait for retained replay');
 assert.doesNotMatch(ctx.pageJournal(),/Real alarm/,'new HA session must clear old events');
 // A retained broker snapshot is delivered on subscription, without Node-RED republishing.
 second.callbacks[0]({...snap([{id:'two',t:Date.now(),txt:'Fresh event'}]),retain:true});
 assert.match(ctx.pageJournal(),/Fresh event/);
 assert.equal(timeouts.size,0,'retained snapshot must complete startup without timeout');
 first.callbacks[1](snap([{id:'old2',t:Date.now(),txt:'Expired session'}]));
 assert.doesNotMatch(ctx.pageJournal(),/Expired session/);
 assert.ok(first.closed.length>=1,'previous subscription is released');
 assert.ok(renders>0);
 console.log('PASS dev76-glow-journal-lifecycle.test.cjs');
})().catch(e=>{console.error(e);process.exitCode=1});
