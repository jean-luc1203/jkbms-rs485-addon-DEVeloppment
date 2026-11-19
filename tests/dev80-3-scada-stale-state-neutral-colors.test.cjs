'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('rootfs/etc/smartphoton_jkbms_multipack/www/scada/index.html','utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script,'SCADA inline JS missing');
new vm.Script(script,{filename:'scada dev80.3'});
assert.match(fs.readFileSync('config.yaml','utf8'),/version: 1\.0\.0-(?:dev80\.3|dev81\.0)/);

const begin=script.indexOf('function renderControlConsole(packId,bms,b){');
const end=script.indexOf('function openBmsControls(',begin);
assert.ok(begin>0&&end>begin,'controls renderer present');
const renderCode=script.slice(begin,end);
const controlDef={key:'display_always_on_switch',label:'LCD',desc:'JK LCD'};
const dryDef={key:'dry1',label:'Dry1',desc:'physical status',bit:2};
let fresh=false,cmd={status:'success',completedAt:Date.now()};
const ctx={
 BMS_CONTROL_DEFS:[controlDef],
 BMS_DRY_STATUS_DEFS:[dryDef],
 readControlState:()=>({available:true,on:true,source:'SETUP ACTIVE POLLING'}),
 readDryState:()=>({available:true,on:true,source:'LIVE'}),
 scadaWritableBms:()=>fresh,
 scadaTelemetryFresh:()=>fresh,
 commandableControl:()=>fresh,
 getControlCommand:()=>cmd,
 spParamUi:()=>'-',
 controlActionHtml:()=>fresh?'<button>COMMANDER</button>':'<strong>LECTURE</strong>',
 commandStatusHtml:c=>c?'<div class="test-status">'+c.status+'</div>':''
};
const render=vm.runInNewContext(renderCode+'\nrenderControlConsole',ctx);
const offline=render('pack_2','1',{});
assert.equal((offline.match(/class="control-card na"/g)||[]).length,2,'both cached ON control and DRY must turn neutral when offline');
assert.doesNotMatch(offline,/class="control-card on/,'no green ON styling during loss of link');
assert.doesNotMatch(offline,/command-success/,'do not color prior confirmation as live success');
assert.doesNotMatch(offline,/test-status">success/,'hide stale confirmed badge during offline');
assert.match(offline,/DONNÉES PÉRIMÉES/);
assert.match(offline,/0\/1 ÉTATS LUS/);
assert.match(offline,/LECTURE/);
cmd={status:'error',message:'failed'};
const failed=render('pack_2','1',{});
assert.match(failed,/command-error/,'keep dangerous failed commands visible while offline');
assert.match(failed,/test-status">error/,'keep rejection visible in audit UI');
fresh=true;cmd=null;
const online=render('pack_2','1',{});
assert.equal((online.match(/class="control-card on/g)||[]).length,2,'active coloring restored on new LIVE');
assert.match(online,/control-value">ACTIF/,'fresh on state returned');
assert.match(online,/1\/1 ÉTATS LUS/);
console.log('PASS dev80-3-scada-stale-state-neutral-colors.test.cjs');
