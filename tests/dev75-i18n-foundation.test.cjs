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
console.log('PASS: DEV75 FR/EN/DE dictionaries, language selection and dashboard JS syntax');
