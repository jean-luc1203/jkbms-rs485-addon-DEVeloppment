const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const paths=['rootfs/etc/smartphoton_jkbms_multipack/www/glow/index.html','rootfs/etc/smartphoton_jkbms_multipack/www/scada/index.html'];
for(const path of paths){
 const html=fs.readFileSync(path,'utf8');
 const script=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
 new vm.Script(script,{filename:path});
 assert.match(script,/smartphoton_multipack_language_v1/);
 assert.match(script,/function spHaLanguage\(/);
 assert.match(script,/function spSetLanguage\(/);
 assert.match(script,/function spApplyLanguage\(/);
 assert.match(script,/spNormalizeLanguage\(spManualLanguage\|\|spHaLanguage\(\)\|\|navigator.language\)/);
 const dictionaries=script.match(/const SP_I18N=([^;]+);/);
 assert.ok(dictionaries,'missing localization dictionary');
 const d=JSON.parse(dictionaries[1]);
 for(const lang of ['fr','en','de']){
  assert.ok(d[lang],lang+' dictionary missing');
  for(const key of Object.keys(d.fr))assert.equal(typeof d[lang][key],'string',lang+': '+key);
 }
 assert.ok(!html.includes('Aucun dépassement des seuils Glow'),'internal name in operator labels');
}
const glow=fs.readFileSync(paths[0],'utf8');
const labelSource=glow.match(/const SP_GLOW_LABELS=([^;]+);/);
assert.ok(labelSource,'Glow label translations missing');
const labels=JSON.parse(labelSource[1]);
assert.ok(Object.keys(labels).length>=70,'Glow translation coverage is below 70 labels');
for(const [fr,tr] of Object.entries(labels)){
 assert.ok(fr.trim(),'empty source label');
 assert.ok(tr.en&&tr.de,'missing English or German for '+fr);
}
assert.match(glow,/function spTranslateGlow\(/);
assert.match(glow,/tickFresh\(\);\s*spTranslateGlow\(\);/);
const dynamicSource=glow.match(/const SP_GLOW_MESSAGES=([^;]+);/);
assert.ok(dynamicSource,'dynamic Glow translations missing');
const dynamic=JSON.parse(dynamicSource[1]);
for(const lang of ['fr','en','de']){
 for(const key of ['delta','temp','warning','critical','weakLow','weakResistance']){
  assert.ok(dynamic[lang][key],lang+' dynamic message missing: '+key);
 }
}
assert.match(glow,/spMessage\('weakLow',\{cell:b\.weak\.cell,days:b\.weak\.lowestDays\}\)/);
assert.match(glow,/spMessage\('weakResistance',\{cell:b\.weak\.cell,rise:b\.weak\.resRise\}\)/);
assert.match(glow,/function spLocale\(\)/);
assert.match(glow,/spMessage\('confirmSend'\)/);
assert.match(glow,/spMessage\('sensitiveNote'\)/);
assert.match(glow,/spMessage\('commandSent'\)/);
assert.match(glow,/spMessage\('commandRejected'\)/);
assert.match(glow,/toLocaleString\(spLocale\(\)/);
assert.doesNotMatch(glow,/toLocale(?:String|TimeString|DateString)\('fr-FR'/);
const scada=fs.readFileSync(paths[1],'utf8');
const scadaLabelsMatch=scada.match(/const SP_SCADA_LABELS=([^;]+);/);
assert.ok(scadaLabelsMatch,'SCADA visual label dictionary missing');
const scadaLabels=JSON.parse(scadaLabelsMatch[1]);
assert.ok(Object.keys(scadaLabels).length>=30,'SCADA requires at least 30 translated operator labels');
for(const [fr,translations] of Object.entries(scadaLabels)){
 assert.ok(fr.trim()&&translations.en&&translations.de,'SCADA missing translation: '+fr);
}
assert.match(scada,/function spTranslateScada\(/);
assert.match(scada,/function spScadaLocale\(/);
assert.match(scada,/spScadaText\('Aucune alarme active sur les packs supervisés'\)/);
assert.doesNotMatch(scada,/toLocale(?:TimeString|DateString|String)\('fr-FR'/);
for(const html of [glow,scada]){
 assert.match(html,/function spSyncLanguage\(/);
 assert.match(html,/addEventListener\('storage'/);
 assert.match(html,/addEventListener\('focus',spSyncLanguage\)/);
}
const operatorMessagesMatch=scada.match(/const SP_SCADA_MESSAGES=([^;]+);/);
assert.ok(operatorMessagesMatch,'missing SCADA dynamic operator translation dictionary');
const operatorMessages=JSON.parse(operatorMessagesMatch[1]);
for(const lang of ['fr','en','de']){
 for(const key of Object.keys(operatorMessages.fr)){
  assert.ok(operatorMessages[lang][key],lang+' missing operator message '+key);
 }
}
assert.match(scada,/spScadaMessage\('topology',\{packs:packs\.length,bms:totalBms\}\)/);
assert.match(scada,/spScadaMessage\('commLost'\)/);
const alarmUiMatch=scada.match(/const SP_ALARM_UI=([^;]+);/);
assert.ok(alarmUiMatch,'SCADA alarm history localization missing');
const alarmUi=JSON.parse(alarmUiMatch[1]);
for(const lang of ['fr','en','de']){
 for(const key of Object.keys(alarmUi.fr))assert.ok(alarmUi[lang][key],lang+' missing SCADA history label '+key);
}
assert.match(scada,/spAlarmText\('observedHelp'\)/);
assert.match(scada,/spAlarmText\('centralDesc'\)/);
assert.match(scada,/spAlarmText\('normal'\)/);
console.log('PASS: DEV75 FR/EN/DE dictionaries, language selection and dashboard JS syntax');
