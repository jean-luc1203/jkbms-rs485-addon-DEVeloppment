/* DEV76 — GLOW journal viewer; read-only Home Assistant MQTT WebSocket subscription.
 * Loads after Glow's main inline script. Same subscription method as SCADA; broker MQTT permissions apply. No browser MQTT credentials.
 */
(function(){
'use strict';
const labels={
 fr:{title:'Journal des événements',unavailable:'Journal indisponible',help:'Vérifiez l’intégration MQTT et les droits de lecture du topic du journal. Aucun événement fictif.',loading:'Chargement du journal…',refresh:'Actualiser',all:'Tous',sites:'Tous les packs',bms:'Tous les BMS',since:'À partir du',none:'Aucun événement pour ces filtres.',count:' événements enregistrés',alarms:'Alarmes',bal:'Équilibrage',flow:'Charge / décharge',settings:'Réglages'},
 en:{title:'Event log',unavailable:'Journal unavailable',help:'Check Home Assistant MQTT integration and journal topic read permissions. No simulated events.',loading:'Loading journal…',refresh:'Refresh',all:'All',sites:'All packs',bms:'All BMS',since:'Since',none:'No events match these filters.',count:' recorded events',alarms:'Alarms',bal:'Balancing',flow:'Charging / discharging',settings:'Settings'},
 de:{title:'Ereignisprotokoll',unavailable:'Protokoll nicht verfügbar',help:'Prüfen Sie die MQTT-Integration und Leserechte für das Journal-Topic. Keine simulierten Ereignisse.',loading:'Ereignisprotokoll wird geladen…',refresh:'Aktualisieren',all:'Alle',sites:'Alle Packs',bms:'Alle BMS',since:'Ab',none:'Keine Ereignisse für diese Filter.',count:' aufgezeichnete Ereignisse',alarms:'Alarme',bal:'Balancing',flow:'Laden / Entladen',settings:'Einstellungen'}
};
const journal={available:false,loading:false,events:[],pack:'all',bms:'all',cat:'all',since:'',checked:false};
const lang=()=>labels[spLanguage]||labels.fr;
const safe=x=>esc(String(x==null?'':x));
const journalRoute=()=>((location.hash||'').slice(1)==='/journal');
const alarmRoute=()=>/\/alarms$/.test(location.hash||'');
const viewerRoute=()=>journalRoute()||alarmRoute();
const originalPageJournal=pageJournal;
const originalPageBms=pageBms;
const JOURNAL_TOPIC='jkbms/glow/journal/snapshot';
let journalConnection=null, journalUnsubscribe=null, journalPending=false;
function fetchJournal(force=false){
 if(S.mode!=='ha')return;
 const conn=S.hass?.connection;
 if(!conn||typeof conn.subscribeMessage!=='function')return;
 if(conn===journalConnection && !force && (journalUnsubscribe||journalPending))return;
 if(journalUnsubscribe){try{journalUnsubscribe()}catch(_){}}
 journalConnection=conn;journalUnsubscribe=null;journalPending=true;
 journal.loading=true;
 conn.subscribeMessage(event=>{
  if(journalConnection!==conn||event?.topic!==JOURNAL_TOPIC)return;
  try{
   const snap=typeof event.payload==='string'?JSON.parse(event.payload):event.payload;
   if(snap?.schema_version!==1||snap?.source!=='node_red'||!Array.isArray(snap.events))return;
   journal.available=true;journal.loading=false;journal.checked=true;
   journal.events=snap.events.slice(0,100).filter(e=>e&&typeof e.t==='number');
   if(viewerRoute())render();
  }catch(err){console.warn('GLOW journal: invalid MQTT snapshot',err)}
 },{type:'mqtt/subscribe',topic:JOURNAL_TOPIC}).then(unsub=>{
  if(journalConnection===conn){journalUnsubscribe=unsub;journalPending=false;journal.loading=false;}
  else if(typeof unsub==='function')unsub();
 }).catch(err=>{
  if(journalConnection!==conn)return;
  journalPending=false;journal.loading=false;journal.checked=true;
  journal.available=false;journal.events=[];
  console.warn('GLOW journal MQTT subscription unavailable (check HA MQTT permissions)',err);
  if(viewerRoute())render();
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
// Add the same authorized journal to the per-BMS Alarms page.
pageBms=function(pack,b,tab){
 const rendered=originalPageBms(pack,b,tab);
 if(S.mode!=='ha'||tab!=='alarms')return rendered;
 const heading='<h2>'+spGlowView('events')+'</h2>';
 const index=rendered.lastIndexOf(heading);
 if(index<0)return rendered;
 const key=String(bmsKey(b));
 const rows=journal.events.filter(e=>e.pack==='pack_'+pack.id&&(e.bms==null||String(e.bms)===key));
 const detail=journal.available?renderRows(rows):
  '<div class="alert info"><b>'+safe(lang().unavailable)+'</b><small>'+safe(lang().help)+'</small></div>';
 return rendered.slice(0,index)+heading+detail;
};
document.addEventListener('click',e=>{
 const refresh=e.target.closest('[data-dev76-refresh]');
 if(refresh){fetchJournal(true);return}
 const category=e.target.closest('[data-dev76-category]');
 if(category){journal.cat=category.dataset.dev76Category;render()}
});
document.addEventListener('change',e=>{
 const key=e.target.dataset.dev76Filter;
 if(!key)return;
 journal[key]=e.target.value;
 render();
});
window.addEventListener('hashchange',()=>{if(viewerRoute())fetchJournal()});
setInterval(()=>{if(viewerRoute())fetchJournal()},30000);
// The HA iframe session may connect after this script loads: retry first read promptly.
setInterval(()=>{if(viewerRoute()&&!journal.checked&&!journal.loading)fetchJournal()},2000);
if(viewerRoute())fetchJournal();
})();
