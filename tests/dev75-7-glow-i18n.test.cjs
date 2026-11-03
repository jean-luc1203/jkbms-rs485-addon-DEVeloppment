'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const html=fs.readFileSync(path.join(__dirname,'../rootfs/etc/smartphoton_jkbms_multipack/www/glow/index.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script,'Glow inline script missing');
new vm.Script(script,{filename:'glow/index.html'});

for(const name of ['SP_GLOW_OVERVIEW_I18N','SP_GLOW_CARD_I18N','SP_GLOW_TIME_UNITS','SP_GLOW_VIEWS_I18N','SP_GLOW_BMS_UI','SP_GLOW_DIAG_I18N','SP_GLOW_CELL_I18N','SP_GLOW_DETAIL_I18N']){
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

// Explicit route-level translation: no raw French for the main view headings.
for(const key of ['independent','comparison','extremes','activeIssues','noIssue','thresholds','bySite','events','eventCount']){
 assert.ok(script.includes("spGlowView('"+key+"'"),'missing route translation: '+key);
}
for(const key of ['packView','compareBms','packBms','totalPower','worstBms','cellVoltage','controlSwitches','energy','stale','lastMeasure']){
 assert.ok(script.includes("spGlowBmsUi('"+key+"'"),'missing BMS translation: '+key);
}
assert.ok(script.includes("spGlowBmsUi(E?'editMode':'readOnly')"));
assert.ok(script.includes("spGlowBmsUi('save')"));
assert.ok(script.includes("spGlowBmsUi('cancel')"));
// Diagnostics: translated operator messages in all three languages.
for(const key of ['missing','missingHelp','offline','offlineHelp','alarmHelp','delta','deltaHelp','temp','tempHelp','lowSoc','lowSocHelp','stale','staleHelp','weakLow','weakLowHelp','weakResistance','weakResistanceHelp']){
 assert.ok(script.includes("spGlowDiag('"+key+"'"),'missing diagnostic display translation: '+key);
}
// Preserve exact BMS entity keys; use separate labels only in the view.
const translatedParams=script.match(/^const SP_GLOW_PARAM_LABELS=(.+);$/m);
assert.ok(translatedParams,'technical parameter dictionary missing');
const paramDict=JSON.parse(translatedParams[1]);
const definitionSource=script.split('const PARAM_DEF = {')[1]?.split('const SW_DEF =')[0];
assert.ok(definitionSource,'technical parameter definitions missing');
const paramKeys=[...definitionSource.matchAll(/'(bms_[a-z0-9_]+)',/g)].map(m=>m[1]);
assert.equal(paramKeys.length,30);
for(const lang of ['en','de']){
 assert.deepEqual(Object.keys(paramDict[lang]).sort(),paramKeys.slice().sort(),'parameter identity mismatch: '+lang);
 for(const key of paramKeys)assert.ok(paramDict[lang][key],lang+' missing '+key);
}
for(const needle of ['spGlowParamLabel(k,l)','label:spGlowParamLabel(k,d.label)','label:spGlowLabel(SW_DEF.find(s=>s[0]===k)[1])','spGlowParamGroup(g)'])
 assert.ok(script.includes(needle),'missing presentation localization: '+needle);
// Compare-view labels and per-cell descriptions must be translated without changing BMS IDs.
for(const needle of [
 "spGlowParamLabel(k,l)",
 "spGlowParamGroup(g)",
 "spGlowCell('different',{n:nd})",
 "spGlowCell('balanced')",
 "spGlowCell('slight')",
 "spGlowCell('hardwareAlarm',{alarms:b.alarms.join(', ')})",
 "spGlowCell('mapIntro')",
 "spGlowCell('cellDeltaTooltip'",
 "spGlowCell('cellTooltip'",
 "spGlowDetail('res30',{cell:b.weak.cell})",
 "spGlowDetail('paramDiff',{n:nd})",
 "spGlowDetail('socHistory')",
 "spGlowDetail('powerHistory')",
 "spGlowDetail('deltaHistory')",
 "spGlowDetail('tempHistory')"
])assert.ok(script.includes(needle),'Glow view not translated: '+needle);

// Exercise the cell report with a temperature alarm in each language.
// Raw hardware alarm wording is preserved; no speculative low-SOC diagnosis.
const cellDict=JSON.parse(script.match(/^const SP_GLOW_CELL_I18N=(.+);$/m)[1]);
const reportCode=script.split('function cellReport(b){')[1]?.split('function cellMap(p){')[0];
assert.ok(reportCode,'cellReport function missing');
const simulated={
 cells:Array.from({length:16},(_,i)=>i===0?3.27:3.30),
 deltaMv:30,
 weak:{lowestDays:0,resRise:0,cell:1},
 alarms:['MOS overtemperature']
};
const reportTranslations={
 fr:'Alarme matérielle active',
 en:'Active BMS hardware alarm',
 de:'Aktiver BMS-Hardwarealarm'
};
for(const lang of ['fr','en','de']){
 const ctx={b:simulated,dict:cellDict,lang};
 const src="const spLanguage=lang; const TH={deltaWarn:20}; const f=(n,d)=>Number(n).toFixed(d);"+
  "const dL=()=> 'warn';"+
  "function spGlowCell(k,v={}){return (dict[spLanguage][k]||dict.fr[k]||k).replace(/\\{(\\w+)\\}/g,(_,k)=>String(v[k]??''))}"+
  "function cellReport(b){"+reportCode+
  "const out=cellReport(b);out;";
 const res=vm.runInNewContext(src,ctx);
 assert.ok(res.text.includes(reportTranslations[lang]),'wrong hardware alarm label in '+lang);
 assert.ok(res.text.includes('MOS overtemperature'),'hardware alarm name lost in '+lang);
 assert.ok(!res.text.includes('niveau de charge trop bas'),'unjustified SOC diagnosis in '+lang);
 assert.ok(res.title.includes(lang==='fr'?'Cellule':lang==='en'?'Cell':'Zelle'),'cell report title not localized in '+lang);
}
// Translation must not modify communication and BMS command code.
const idx=script.indexOf('function spGlowOverview(');
const idx2=script.indexOf('function spGlowText(',idx);
assert.ok(idx>=0&&idx2>idx);
assert.ok(!/callService|mqtt|publish\(/i.test(script.slice(idx,idx2)));
console.log('PASS DEV75.7 Glow FR/EN/DE overview, cards, relative time, and JS syntax');
