/* DEV76 — GLOW journal viewer; read-only, admin-only Home Assistant WebSocket.
 * Loads after Glow's main inline script. No access to broker passwords or Node-RED HTTP.
 */
(function(){
'use strict';
const labels={
 fr:{title:'Journal des événements',unavailable:'Journal indisponible',help:'Installez et activez le lecteur sécurisé SmartPhoton dans Home Assistant. Aucun événement fictif.',loading:'Chargement du journal…',refresh:'Actualiser',all:'Tous',sites:'Tous les packs',bms:'Tous les BMS',since:'À partir du',none:'Aucun événement pour ces filtres.',count:' événements enregistrés',alarms:'Alarmes',bal:'Équilibrage',flow:'Charge / décharge',settings:'Réglages'},
 en:{title:'Event log',unavailable:'Journal unavailable',help:'Install and enable the SmartPhoton secure reader in Home Assistant. No simulated events.',loading:'Loading journal…',refresh:'Refresh',all:'All',sites:'All packs',bms:'All BMS',since:'Since',none:'No events match these filters.',count:' recorded events',alarms:'Alarms',bal:'Balancing',flow:'Charging / discharging',settings:'Settings'},
 de:{title:'Ereignisprotokoll',unavailable:'Protokoll nicht verfügbar',help:'Installieren und aktivieren Sie den sicheren SmartPhoton-Leser in Home Assistant. Keine simulierten Ereignisse.',loading:'Ereignisprotokoll wird geladen…',refresh:'Aktualisieren',all:'Alle',sites:'Alle Packs',bms:'Alle BMS',since:'Ab',none:'Keine Ereignisse für diese Filter.',count:' aufgezeichnete Ereignisse',alarms:'Alarme',bal:'Balancing',flow:'Laden / Entladen',settings:'Einstellungen'}
};
const journal={available:false,loading:false,events:[],pack:'all',bms:'all',cat:'all',since:'',checked:false};
const lang=()=>labels[spLanguage]||labels.fr;
const safe=x=>esc(String(x==null?'':x));
const journalRoute=()=>((location.hash||'').slice(1)==='/journal');
const originalPageJournal=pageJournal;
function fetchJournal(){
 if(S.mode!=='ha'||journal.loading||!haReady())return;
 journal.loading=true;
 wsSend({type:'smartphoton_glow_journal/list',limit:250},(value)=>{
  journal.loading=false;journal.checked=true;
  journal.available=!!(value&&value.available===true&&Array.isArray(value.events));
  journal.events=journal.available?value.events.filter(e=>e&&typeof e.t==='number'):[];
  if(journalRoute())render();
 });
}
function renderRows(rows){
 if(!rows.length)return '<div class="alert info">'+safe(lang().none)+'</div>';
 let output='<div class="card events">';
 for(const event of rows){
  const time=new Date(event.t);
  if(!Number.isFinite(time.getTime()))continue;
  const name=PACKS.find(p=>'pack_'+p.id===event.pack);
  const details=[name?name.name:event.pack,event.bms!=null?'BMS '+event.bms:null,event.det].filter(Boolean).map(safe).join(' · ');
  output+='<div class="ev"><time>'+safe(time.toLocaleString(spLocale(),{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}))+'</time><span class="dot '+(event.lvl==='crit'?'crit':event.lvl==='warn'?'warn':'')+'"></span><div><b>'+safe(event.txt)+'</b><small>'+details+'</small></div></div>';
 }
 return output+'</div>';
}
pageJournal=function(){
 if(S.mode!=='ha')return originalPageJournal();
 const l=lang();
 let out=header(spGlowLabel('Parc'),safe(l.title),'<span class="pill">'+(journal.available?journal.events.length+safe(l.count):safe(l.unavailable))+'</span>');
 if(!journal.available){
  out+='<div class="alert info"><span class="ic">ℹ️</span><div><b>'+safe(journal.loading?l.loading:l.unavailable)+'</b><small>'+safe(l.help)+'</small></div></div>';
  return out+'<button class="btn" data-dev76-refresh="1">'+safe(l.refresh)+'</button>';
 }
 const packs=Array.from(new Set(journal.events.map(e=>e.pack).filter(Boolean))).sort();
 const bmses=Array.from(new Set(journal.events.map(e=>e.bms).filter(v=>v!=null).map(String))).sort();
 out+='<div class="row" style="flex-wrap:wrap;gap:8px;margin-bottom:12px">';
 out+='<select class="inp" data-dev76-filter="pack"><option value="all">'+safe(l.sites)+'</option>'+packs.map(p=>'<option value="'+safe(p)+'" '+(journal.pack===p?'selected':'')+'>'+safe(PACKS.find(x=>'pack_'+x.id===p)?.name||p)+'</option>').join('')+'</select>';
 out+='<select class="inp" data-dev76-filter="bms"><option value="all">'+safe(l.bms)+'</option>'+bmses.map(v=>'<option value="'+safe(v)+'" '+(journal.bms===v?'selected':'')+'>BMS '+safe(v)+'</option>').join('')+'</select>';
 out+='<label>'+safe(l.since)+' <input class="inp" type="date" data-dev76-filter="since" value="'+safe(journal.since)+'"></label>';
 out+='<button class="btn" data-dev76-refresh="1">'+safe(l.refresh)+'</button></div>';
 const categories=[['all',l.all],['alarm',l.alarms],['bal',l.bal],['flow',l.flow],['param',l.settings]];
 out+='<div class="seg" style="margin-bottom:12px">'+categories.map(([k,v])=>'<button data-dev76-category="'+k+'" class="'+(journal.cat===k?'on':'')+'">'+safe(v)+'</button>').join('')+'</div>';
 let filtered=journal.events.filter(e=>(journal.pack==='all'||e.pack===journal.pack)&&(journal.bms==='all'||String(e.bms)===journal.bms)&&(journal.cat==='all'||e.cat===journal.cat));
 if(journal.since){
  const start=Date.parse(journal.since+'T00:00:00');
  if(Number.isFinite(start))filtered=filtered.filter(e=>e.t>=start);
 }
 return out+renderRows(filtered);
};
document.addEventListener('click',e=>{
 const refresh=e.target.closest('[data-dev76-refresh]');
 if(refresh){fetchJournal();return}
 const category=e.target.closest('[data-dev76-category]');
 if(category){journal.cat=category.dataset.dev76Category;render()}
});
document.addEventListener('change',e=>{
 const key=e.target.dataset.dev76Filter;
 if(!key)return;
 journal[key]=e.target.value;
 render();
});
window.addEventListener('hashchange',()=>{if(journalRoute())fetchJournal()});
setInterval(()=>{if(journalRoute())fetchJournal()},30000);
if(journalRoute())fetchJournal();
})();
