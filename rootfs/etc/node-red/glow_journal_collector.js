// DEV76: persistent private GLOW journal collector.
// Node-RED Function node. Reads existing SCADA audit snapshots and BMS alarm state.
// Storage: global context localfilesystem, bounded. Does NOT publish to MQTT/HA/HTTP.
// The UI will need a separately authorized read path in a later DEV76 step.
const KEY='jkbms_glow_journal_v1', LIMIT=250, AGE=30*86400000, now=Date.now();
let store=global.get(KEY);
if(!store || typeof store!=='object' || Array.isArray(store))store={};
if(!Array.isArray(store.events))store.events=[];
if(!store.hardware || typeof store.hardware!=='object'||Array.isArray(store.hardware))store.hardware={};
const original=JSON.stringify(store);
const brief=(v,n=150)=>String(v??'').slice(0,n);
const stamp=v=>{
 const t=typeof v==='string'&&!/^\d+$/.test(v)?Date.parse(v):Number(v);
 return Number.isFinite(t)&&t>946684800000&&t<=now+60000?t:null;
};
const pack=v=>/^pack_[1-5]$/.test(String(v))?String(v):null;
const bms=v=>/^(?:master|\d{1,2})$/.test(String(v))?String(v):null;
function add(x){
 const t=stamp(x.t);
 if(!t || t<now-AGE || !x.id)return;
 const e={id:brief(x.id,180),t,cat:x.cat||'alarm',lvl:x.lvl||'info',
   pack:x.pack||null,bms:x.bms||null,txt:brief(x.txt,140),det:brief(x.det,220)};
 const idx=store.events.findIndex(v=>v.id===e.id);
 if(idx<0)store.events.push(e);else store.events[idx]=e;
}
function snapshot(x){
 if(!x || x.source!=='node_red'|| !x.command_audit || !x.alarm_lifecycle)return;
 for(const c of (Array.isArray(x.command_audit.history)?x.command_audit.history:[]).slice(0,60)){
  const p=pack(c.pack_id),b=bms(c.bms),t=stamp(c.started_at);
  if(!p||!b||!t||!c.id)continue;
  const st=brief(c.status||'unknown',32);
  add({id:'command:'+c.id,t,cat:'param',
   lvl:['failed','rejected','timeout','not_confirmed'].includes(st)?'warn':'info',
   pack:p,bms:b,txt:'BMS command: '+brief(c.control_label||c.control_key,80),
   det:st});
 }
 const a=x.alarm_lifecycle;
 const active=Array.isArray(a.active)?a.active.slice(0,20):[];
 const history=Array.isArray(a.history)?a.history.slice(0,40):[];
 for(const v of [...history,...active]){
  const p=pack(v.pack_id),t=stamp(v.first_seen);
  if(!p||!t||!v.id||!v.code)continue;
  const label=brief(v.code,60);
  add({id:'alarm:on:'+v.id,t,cat:'alarm',lvl:v.severity==='ALARME'?'crit':'warn',
    pack:p,bms:null,txt:label+' active',det:brief(v.message||v.value||'',180)});
  const cleared=stamp(v.cleared_at);
  if(cleared)add({id:'alarm:off:'+v.id,t:cleared,cat:'alarm',lvl:'info',
    pack:p,bms:null,txt:label+' cleared',det:''});
 }
}
function hardware(topic,value,retained){
 const m=topic.match(/^jkbms\/(pack_[1-5])\/BMS_(\d{1,2}|master)\/alarm\/active$/);
 if(!m)return;
 const p=m[1],b=m[2],key=p+':'+b;
 const v=String(value).trim().toUpperCase();
 if(v!=='ON'&&v!=='OFF')return;
 const previous=store.hardware[key];
 // No synthetic alarm on initial or retained MQTT state (restart/reconnect).
 if(previous && previous.value!==v && !retained){
  add({id:'hardware:'+key+':'+now+':'+v,t:now,cat:'alarm',
   lvl:v==='ON'?'crit':'info',pack:p,bms:b,
   txt:v==='ON'?'JK-BMS hardware alarm active':'JK-BMS hardware alarm cleared',det:v});
 }
 if(!previous||previous.value!==v||now-Number(previous.seen||0)>3600000)store.hardware[key]={value:v,seen:now};
}
let payload=msg.payload;
if(Buffer.isBuffer(payload))payload=payload.toString('utf8');
const topic=String(msg.topic||'');
if(topic==='jkbms/scada/audit/snapshot'){
 if(typeof payload==='string'){try{payload=JSON.parse(payload)}catch(_){payload=null}}
 snapshot(payload);
}else hardware(topic,payload,msg.retain===true);
store.events=store.events.filter(x=>stamp(x?.t)&&x.t>=now-AGE).sort((a,b)=>b.t-a.t||a.id.localeCompare(b.id)).slice(0,LIMIT);
for(const [key,v] of Object.entries(store.hardware))if(!v||now-Number(v.seen||0)>AGE)delete store.hardware[key];
if(JSON.stringify(store)!==original)global.set(KEY,store);
node.status({fill:'green',shape:'dot',text:'private journal '+store.events.length+' events'});
return null;
