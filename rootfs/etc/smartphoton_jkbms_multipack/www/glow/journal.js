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
let journalGeneration=0, journalTimeout=null;
const JOURNAL_WAIT_MS=12000;
function clearJournalWait(){
 if(journalTimeout!==null){clearTimeout(journalTimeout);journalTimeout=null;}
}
function fetchJournal(force=false){
 if(S.mode!=='ha')return;
 const conn=S.hass?.connection;
 if(!conn||typeof conn.subscribeMessage!=='function')return;
 if(conn===journalConnection && !force && (journalUnsubscribe||journalPending))return;
 // A refresh or new HA session invalidates old callbacks and old retained data.
 const generation=++journalGeneration;
 clearJournalWait();
 if(journalUnsubscribe){try{journalUnsubscribe()}catch(_){}}
 journalConnection=conn;journalUnsubscribe=null;journalPending=true;
 journal.available=false;journal.checked=false;journal.events=[];journal.loading=true;
 journalTimeout=setTimeout(()=>{
  if(generation!==journalGeneration||journal.checked)return;
  journalTimeout=null;journal.loading=false;journal.checked=true;
  // Do not unsubscribe: a valid delayed retained snapshot may still arrive.
  if(viewerRoute())render();
 },JOURNAL_WAIT_MS);
 if(viewerRoute())render();
 conn.subscribeMessage(event=>{
  if(generation!==journalGeneration||journalConnection!==conn||event?.topic!==JOURNAL_TOPIC)return;
  try{
   const snap=typeof event.payload==='string'?JSON.parse(event.payload):event.payload;
   if(snap?.schema_version!==1||snap?.source!=='node_red'||!Array.isArray(snap.events))return;
   clearJournalWait();
   journal.available=true;journal.loading=false;journal.checked=true;
   journal.events=snap.events.slice(0,100).filter(e=>e&&typeof e.t==='number');
   if(viewerRoute())render();
  }catch(err){console.warn('GLOW journal: invalid MQTT snapshot',err)}
 },{type:'mqtt/subscribe',topic:JOURNAL_TOPIC}).then(unsub=>{
  if(generation===journalGeneration && journalConnection===conn){
   journalUnsubscribe=unsub;journalPending=false;
  }else if(typeof unsub==='function')unsub();
 }).catch(err=>{
  if(generation!==journalGeneration||journalConnection!==conn)return;
  clearJournalWait();
  journalPending=false;journal.loading=false;journal.checked=true;
  journal.available=false;journal.events=[];
  console.warn('GLOW journal MQTT subscription unavailable (check HA MQTT permissions)',err);
  if(viewerRoute())render();
 });
}
// DEV76.1: translate known event codes only at presentation time; MQTT remains untouched.
const EVENT_WORDS={
 fr:{active:'déclenchée',cleared:'terminée',delta:'Écart de tension des cellules',temp:'Température élevée',offline:'Pack hors ligne',command:'Commande BMS',hardwareOn:'Alarme matérielle JK-BMS déclenchée',hardwareOff:'Alarme matérielle JK-BMS terminée',current:'Sens du courant du pack',balance:'Équilibrage BMS',reached:'a atteint',internal:'présente un écart de tension interne de',stale:'est hors ligne ou ne transmet plus'},
 en:{active:'active',cleared:'cleared',delta:'Cell voltage difference',temp:'High temperature',offline:'Pack offline',command:'BMS command',hardwareOn:'JK-BMS hardware alarm active',hardwareOff:'JK-BMS hardware alarm cleared',current:'Pack current direction',balance:'BMS balancing',reached:'reached',internal:'has an internal cell delta of',stale:'is offline or stale'},
 de:{active:'ausgelöst',cleared:'beendet',delta:'Zellspannungsdifferenz',temp:'Hohe Temperatur',offline:'Pack offline',command:'BMS-Befehl',hardwareOn:'JK-BMS-Hardwarealarm ausgelöst',hardwareOff:'JK-BMS-Hardwarealarm beendet',current:'Stromrichtung des Packs',balance:'BMS-Zellenausgleich',reached:'hat erreicht',internal:'hat eine interne Zellspannungsdifferenz von',stale:'ist offline oder liefert keine aktuellen Daten'}
};
function eventWords(){return EVENT_WORDS[spLanguage]||EVENT_WORDS.fr;}
function eventTitle(event){
 const raw=String(event.txt||''),w=eventWords();
 const known=/^(CELL_DELTA_HIGH|TEMPERATURE_HIGH|PACK_OFFLINE) (active|cleared)$/i.exec(raw);
 if(known){
  const code={CELL_DELTA_HIGH:w.delta,TEMPERATURE_HIGH:w.temp,PACK_OFFLINE:w.offline}[known[1].toUpperCase()];
  return code+' — '+w[known[2].toLowerCase()];
 }
 if(raw.startsWith('BMS command: '))return w.command+': '+raw.slice(13);
 if(raw==='JK-BMS hardware alarm active')return w.hardwareOn;
 if(raw==='JK-BMS hardware alarm cleared')return w.hardwareOff;
 if(raw==='Pack current direction')return w.current;
 if(raw==='BMS balancing')return w.balance;
 return raw; // Preserve unknown codes, never invent a translation.
}
function eventDetail(event,packName){
 let detail=String(event.det||'').trim();
 if(packName && detail.startsWith(packName+' '))detail=detail.slice(packName.length+1);
 const w=eventWords();
 detail=detail.replace(/has an internal cell delta of/g,w.internal)
  .replace(/reached (\d+(?:[.,]\d+)?\s*°C)/g,(_,v)=>w.reached+' '+v)
  .replace(/is offline or stale\.?/g,w.stale+'.');
 return detail;
}
function eventTime(ms){
 const d=new Date(ms);
 if(!Number.isFinite(d.getTime()))return '';
 const two=n=>String(n).padStart(2,'0');
 return two(d.getDate())+'/'+two(d.getMonth()+1)+' '+two(d.getHours())+':'+two(d.getMinutes());
}
const filterStyle='color:#edf4ff!important;background-color:#152743!important;border:1px solid #405a81!important;min-height:36px!important;font-size:13px!important;';
const optionStyle='color:#edf4ff;background-color:#152743;';
function renderRows(rows){
 if(!rows.length)return '<div class="alert info">'+safe(lang().none)+'</div>';
 let output='<div class="card events">';
 for(const event of rows){
  const time=new Date(event.t);
  if(!Number.isFinite(time.getTime()))continue;
  const name=PACKS.find(p=>'pack_'+p.id===event.pack);
  const packName=name?name.name:event.pack;
  const details=[packName,event.bms!=null?'BMS '+event.bms:null,eventDetail(event,name?.name)].filter(Boolean).map(safe).join(' · ');
  output+='<div class="ev"><time>'+safe(eventTime(event.t))+'</time><span class="dot '+(event.lvl==='crit'?'crit':event.lvl==='warn'?'warn':'')+'"></span><div><b>'+safe(eventTitle(event))+'</b><small>'+details+'</small></div></div>';
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
 out+='<select class="inp" style="'+filterStyle+'min-width:180px;max-width:100%;" data-dev76-filter="pack"><option style="'+optionStyle+'" value="all">'+safe(l.sites)+'</option>'+packs.map(p=>'<option style="'+optionStyle+'" value="'+safe(p)+'" '+(journal.pack===p?'selected':'')+'>'+safe(PACKS.find(x=>'pack_'+x.id===p)?.name||p)+'</option>').join('')+'</select>';
 out+='<select class="inp" style="'+filterStyle+'min-width:145px;max-width:100%;" data-dev76-filter="bms"><option style="'+optionStyle+'" value="all">'+safe(l.bms)+'</option>'+bmses.map(v=>'<option style="'+optionStyle+'" value="'+safe(v)+'" '+(journal.bms===v?'selected':'')+'>BMS '+safe(v)+'</option>').join('')+'</select>';
 out+='<label style="display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap">'+safe(l.since)+' <input class="inp" style="'+filterStyle+'min-width:175px;width:175px;color-scheme:dark;" type="date" data-dev76-filter="since" value="'+safe(journal.since)+'"></label>';
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
