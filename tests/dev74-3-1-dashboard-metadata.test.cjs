'use strict';
// DEV74.3.1 regression: tests the actual dashboard_sync.js WebSocket request
// sequence. No HA token, network, or service is accessed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sync = fs.readFileSync(path.join(__dirname,'..','rootfs/etc/node-red/dashboard_sync.js'),'utf8');
const dashboards=[
  ['smart_jkbms_glow.json','smart-jkbms-glow','JK-BMS MultiPack'],
  ['smart_jkbms_scada.json','smart-jkbms-scada','JK-BMS SCADA'],
  ['smart_jkbms_multipack.json','smart-jkbms-multipack','JK-BMS Diagnostics']
];

async function run(file,url,title,behavior='existing'){
  const requests=[],logs=[],errors=[],exits=[];
  const dashboard={id:'storage-id-'+url,url_path:url,title:'Old sidebar title',mode:'storage'};
  const input={dashboard_meta:{url_path:url,title,icon:'mdi:battery',show_in_sidebar:true,require_admin:false},
    config:{views:[{title:'Diagnostics'}]}};
  let ws;
  class FakeWebSocket{
    constructor(address){assert.equal(address,'ws://supervisor/core/websocket');ws=this}
    send(json){
      const msg=JSON.parse(json);requests.push(msg);
      const id=msg.id;
      if(msg.type==='auth'){
        assert.equal(msg.access_token,'dummy-token');
        queueMicrotask(()=>this.onmessage({data:JSON.stringify({type:'auth_ok'})}));
        return;
      }
      if(!id)throw Error('Unexpected command without id');
      let result=null,error=null;
      if(msg.type==='lovelace/dashboards/create'){
        if(behavior==='create') result={id:dashboard.id};
        else error={message:'Dashboard already exists'};
      }else if(msg.type==='lovelace/dashboards/list'){
        result=behavior==='missing-registration'?[]:[dashboard];
      }else if(msg.type==='lovelace/dashboards/update'){
        assert.deepEqual(Object.keys(msg).sort(),[
          'dashboard_id','icon','id','require_admin','show_in_sidebar','title','type'
        ].sort(),'Dashboard update must not contain url_path or mode');
        assert.equal(msg.dashboard_id,dashboard.id);
        assert.equal(msg.title,title);
        if(behavior==='reject-update')error={message:'Failed dashboard metadata update'};
        else result={};
      }else if(msg.type==='lovelace/config/save'){
        assert.equal(msg.url_path,url);
        assert.equal(msg.config.views.length,1);
        result={};
      }else throw Error('Unexpected WebSocket command '+msg.type);
      queueMicrotask(()=>this.onmessage({data:JSON.stringify({
        id,success:!error,...(error?{error}:{result})
      })}));
    }
    close(){}
  }
  const context={
    require(name){
      if(name==='fs')return {existsSync:()=>true,readFileSync:()=>JSON.stringify(input)};
      if(name==='path')return path;
      throw Error('Unplanned dependency '+name);
    },
    process:{
      argv:['node','dashboard_sync.js','upsert','/config/dashboards/'+file],
      env:{SUPERVISOR_TOKEN:'dummy-token'},
      exit(code){exits.push(code)}
    },
    WebSocket:FakeWebSocket,
    console:{log:s=>logs.push(s),error:s=>errors.push(s)},
    queueMicrotask
  };
  vm.runInNewContext(sync,context,{timeout:2000});
  ws.onmessage({data:JSON.stringify({type:'auth_required'})});
  // All asynchronous WebSocket responses were enqueued with queueMicrotask.
  for(let i=0;i<15 && !exits.length;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(exits.length,1,'Dashboard sync did not terminate');
  const calls=requests.map(r=>r.type);
  if(['missing-registration','reject-update'].includes(behavior)){
    assert.equal(exits[0],1,'Metadata failure must not be hidden behind OK');
    assert(!calls.includes('lovelace/config/save'),'Do not claim upsert success after metadata failure');
    assert(errors.some(s=>JSON.parse(s).ok===false));
  }else{
    assert.equal(exits[0],0,errors.join('\n'));
    assert.deepEqual(calls.slice(1),[
      'lovelace/dashboards/create',
      'lovelace/dashboards/list',
      'lovelace/dashboards/update',
      'lovelace/config/save'
    ]);
    const result=JSON.parse(logs[0]);
    assert.equal(result.updated_dashboard,true);
    assert.equal(result.dashboard_id,dashboard.id);
    assert.equal(result.title,title);
    assert.equal(result.dashboard,url);
  }
}

(async()=>{
 for(const [file,url,title] of dashboards)await run(file,url,title);
 await run(...dashboards[0],'create');
 await run(...dashboards[0],'missing-registration');
 await run(...dashboards[0],'reject-update');
 console.log('PASS: DEV74.3.1 sidebar metadata uses dashboard_id, preserves URL and detects rejected updates');
})().catch(e=>{console.error(e);process.exitCode=1});
