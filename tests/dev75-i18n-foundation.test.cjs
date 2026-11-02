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
assert.match(scada,/addOperatorLocalized\('Topologie','topology',\{packs:packs\.length,bms:totalBms\}\)/);
assert.match(scada,/addOperatorLocalized\(p\.name,snap\.online\?'commRestored':'commLost'/);
const alarmUiMatch=scada.match(/const SP_ALARM_UI=([^;]+);/);
assert.ok(alarmUiMatch,'SCADA alarm history localization missing');
const alarmUi=JSON.parse(alarmUiMatch[1]);
for(const lang of ['fr','en','de']){
 for(const key of Object.keys(alarmUi.fr))assert.ok(alarmUi[lang][key],lang+' missing SCADA history label '+key);
}
assert.match(scada,/spAlarmText\('observedHelp'\)/);
assert.match(scada,/spAlarmText\('centralDesc'\)/);
assert.match(scada,/spAlarmText\('normal'\)/);
const glowDynamicMatch=glow.match(/const SP_GLOW_DYNAMIC=([^;]+);/);
assert.ok(glowDynamicMatch,'missing Glow dynamic translations');
const glowDynamic=JSON.parse(glowDynamicMatch[1]);
for(const lang of ['fr','en','de'])for(const key of ['watch','alarm','before','idle','inRange'])assert.ok(glowDynamic[lang][key],lang+' missing '+key);
assert.match(glow,/spGlowLabel\('Vue d’ensemble'\)/);
assert.match(glow,/spGlowText\('before',\{pct:100\}\)/);
const scadaCategoriesMatch=scada.match(/const SP_SCADA_CATEGORY=([^;]+);/);
assert.ok(scadaCategoriesMatch,'missing SCADA event categories');
const scadaCategories=JSON.parse(scadaCategoriesMatch[1]);
for(const lang of ['fr','en','de'])for(const key of ['Température','Cellules'])assert.ok(scadaCategories[lang][key]);
assert.match(scada,/spScadaCategory\(r\.category\)/);
assert.match(scada,/id="sp-scada-close"/);
const scadaDetailMatch=scada.match(/const SP_SCADA_DETAIL_I18N=([^;]+);/);
assert.ok(scadaDetailMatch,'missing SCADA alarm detail and command translations');
const scadaDetail=JSON.parse(scadaDetailMatch[1]);
for(const lang of ['fr','en','de']){
 for(const key of Object.keys(scadaDetail.fr)){
  assert.ok(scadaDetail[lang][key],lang+' missing detail message '+key);
 }
}
for(const key of ['confirmDry','confirmParam','criticalParameter','technicalParameter','alarmDetail','alarmHistory']){
 assert.match(scada,new RegExp("spDetail\\('"+key+"'"));
}
assert.match(scada,/spDetail\(target\?'confirmOn':'confirmOff',\{label:def\.label\}\)/);
assert.match(scada,/function spDetail\(/);
const synopticMatch=scada.match(/Object\.assign\(SP_SCADA_LABELS,([^;]+)\);/);
assert.ok(synopticMatch,'missing SCADA synoptic translations');
const synoptic=JSON.parse(synopticMatch[1]);
for(const key of ['Synoptique Multi‑Pack','ÉTAT CONDUITE','MODE PROCESS','FRAÎCHEUR MAX','Chaîne énergétique SmartPhoton','Cliquer sur un pack pour ouvrir sa fiche opérateur']){
 assert.ok(synoptic[key]?.en && synoptic[key]?.de,'missing synoptic translation: '+key);
 assert.ok(scada.includes(key),'synoptic source label absent: '+key);
}
assert.match(scada,/healthText'\)\.textContent=spScadaText\('Aucun seuil diagnostic actif'\)/);
const processMatch=scada.match(/const SP_SCADA_PROCESS_I18N=([^;]+);/);
assert.ok(processMatch,'missing SCADA dynamic process translations');
const processI18n=JSON.parse(processMatch[1]);
for(const key of Object.keys(processI18n.fr)){
 for(const lang of ['en','de'])assert.ok(processI18n[lang][key],lang+' missing process key '+key);
}
for(const key of ['batteryFlow','packHint','logicBus','issues','diagnosticsOffline','modeCharge']){
 assert.ok(scada.includes("spProcessText("),'missing process localization call');
 assert.ok(processI18n.en[key]&&processI18n.de[key]);
}
assert.match(scada,/function addOperatorLocalized\(/);
assert.match(scada,/e\.key\?spScadaMessage\(e\.key,e\.args\):e\.text/);
assert.match(scada,/addOperatorLocalized\(p\.name,'cellDelta'/);
const scadaViewMatch=scada.match(/const SP_SCADA_VIEW_LABELS=([^;]+);/);
assert.ok(scadaViewMatch,'missing Packs/BMS/Service label dictionary');
const scadaView=JSON.parse(scadaViewMatch[1]);
for(const [fr,languages] of Object.entries(scadaView)){
 assert.ok(fr&&languages.en&&languages.de,'missing operator-view translation: '+fr);
}
for(const label of ['Mesures instantanées','Capacité restante','État des packs','Diagnostic Premium','Modules BMS du pack']){
 assert.ok(scadaView[label],'missing view dictionary label: '+label);
 assert.ok(scada.includes('spView("'+label+'")'),'view does not render localized label: '+label);
}
assert.match(scada,/function spView\(fr\)/);
const paramUiMatch=scada.match(/const SP_PARAM_UI=([^;]+);/);
assert.ok(paramUiMatch,'technical parameter screen localization missing');
const paramUi=JSON.parse(paramUiMatch[1]);
for(const lang of ['fr','en','de']){
 for(const key of Object.keys(paramUi.fr))assert.ok(paramUi[lang][key],lang+' missing parameter UI '+key);
}
for(const key of ['title','config','accessible','expert','warn','modify','readonly']){
 assert.ok(scada.includes("spParamUi('"+key+"')"),'parameter view not using '+key);
}
assert.match(scada,/requestParameterCommand\('\$\{packId\}','\$\{bms\}','\$\{def\.key\}'\)/);
const parameterDefinitions=scada.match(/const SP_PARAM_DEFINITIONS_I18N=([^;]+);/);
assert.ok(parameterDefinitions,'missing BMS numeric parameter translations');
const translatedParameters=JSON.parse(parameterDefinitions[1]);
assert.equal(Object.keys(translatedParameters).length,30,'all 30 numeric BMS parameters must be translated');
for(const [key,languages] of Object.entries(translatedParameters)){
 for(const lang of ['en','de']){
  assert.ok(languages[lang]?.label&&languages[lang]?.desc,key+' missing '+lang+' label/description');
 }
}
assert.match(scada,/function spParamDefinition\(def,field\)/);
assert.match(scada,/spParamDefinition\(def,'label'\)/);
assert.match(scada,/spParamDefinition\(def,'desc'\)/);
// Regression: the audit all-option texts must be evaluated as template literals.
for(const label of ['Tous les packs','Tous les BMS']){
 const bad=String.fromCharCode(39)+'<option value="all">'+ '${spAuditText("'+label+'")}</option>'+String.fromCharCode(39);
 assert.ok(!scada.includes(bad),'literal JavaScript leaked into audit option '+label);
 assert.ok(scada.includes('spAuditText("'+label+'")'),'missing audit option translation '+label);
}
assert.match(scada,/openAuditOverview\(\);/,'audit overlay must refresh when language changes');
assert.match(scada,/openBmsTechnicalParameters\(currentParameterContext\.packId,currentParameterContext\.bms,true\)/,'parameter overlay must refresh when language changes');
// Regression: language switch must retain unsubmitted numeric form values without sending commands.
assert.match(scada,/function spCaptureParameterDrafts\(\)/);
assert.match(scada,/function spRestoreParameterDrafts\(drafts\)/);
assert.match(scada,/const drafts=spCaptureParameterDrafts\(\);\s*openBmsTechnicalParameters\(currentParameterContext\.packId,currentParameterContext\.bms,true\);\s*spRestoreParameterDrafts\(drafts\);/);
assert.match(scada,/\$\{all\.length\} \$\{spAuditText\('événement\(s\) disponibles'\)\}/);
assert.match(scada,/\$\{rows\.length\} \$\{spAuditText\('ligne\(s\)'\)\}/);
const extraMatch=scada.match(/const SP_PARAM_EXTRA=([^;]+);/);
assert.ok(extraMatch,'parameter secondary translations missing');
const extra=JSON.parse(extraMatch[1]);
for(const lang of ['fr','en','de'])for(const key of ['missing','range','quick','setup','readonly','dryConfig','dryRead'])assert.ok(extra[lang][key],lang+' missing '+key);
assert.ok(scada.includes("spParamExtra('range',{min,max,step})"));
assert.ok(scada.includes("spParamExtra('quick')"));
assert.ok(scada.includes("spParamExtra('dryConfig')"));
assert.ok(scada.includes("spParamExtra('setup')"));
console.log('PASS: DEV75 FR/EN/DE dictionaries, language selection and dashboard JS syntax');
