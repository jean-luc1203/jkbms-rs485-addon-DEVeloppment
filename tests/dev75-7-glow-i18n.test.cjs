'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const html=fs.readFileSync(path.join(__dirname,'../rootfs/etc/smartphoton_jkbms_multipack/www/glow/index.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script,'Glow inline script missing');
new vm.Script(script,{filename:'glow/index.html'});

for(const name of ['SP_GLOW_OVERVIEW_I18N','SP_GLOW_CARD_I18N','SP_GLOW_TIME_UNITS']){
 const line=script.match(new RegExp('^const '+name+'=(.+);$','m'));
 assert.ok(line,name+' missing');
 const dict=JSON.parse(line[1]);
 for(const lang of ['fr','en','de'])assert.ok(dict[lang],name+' missing '+lang);
 if(name!=='SP_GLOW_TIME_UNITS'){
  for(const key of Object.keys(dict.fr))for(const lang of ['en','de'])assert.ok(dict[lang][key],lang+' missing '+key);
 }
}

for(const text of [
 "spGlowLabel('Sites à jour')",
 "spGlowLabel('SOC le plus bas')",
 "spGlowLabel('Autonomie la plus courte')",
 "spGlowLabel('Capacité du parc')",
 "spGlowOverview('minBms')",
 "spGlowOverview('ago'",
 "spGlowCard('historyLoading')",
 "spGlowLabel('Thème clair')",
 "spGlowLabel('Mode écran mural')",
 "spGlowCard(open?'less':'more')",
])assert.ok(script.includes(text),'explicit Glow translation missing: '+text);

const relTime=script.match(/function relTime\(ts\)\{[^\n]+/);
assert.ok(relTime&&relTime[0].includes('SP_GLOW_TIME_UNITS'),'relative time not localized');

// Translation must not modify communication and BMS command code.
const idx=script.indexOf('function spGlowOverview(');
const idx2=script.indexOf('function spGlowText(',idx);
assert.ok(idx>=0&&idx2>idx);
assert.ok(!/callService|mqtt|publish\(/i.test(script.slice(idx,idx2)));
console.log('PASS DEV75.7 Glow FR/EN/DE overview, cards, relative time, and JS syntax');
