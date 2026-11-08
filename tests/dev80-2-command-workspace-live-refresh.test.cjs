'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('rootfs/etc/smartphoton_jkbms_multipack/www/scada/index.html','utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script,'SCADA inline script missing');
new vm.Script(script,{filename:'SCADA DEV80.2'});
assert.match(fs.readFileSync('config.yaml','utf8'),/version: 1\.0\.0-(?:dev80\.[23]|dev81\.0)/);

// Only redraw a command workspace at actual read/write availability transitions.
const fnStart=script.indexOf('function scadaRefreshWritableWorkspace(){');
const fnEnd=script.indexOf('function scadaCancelStaleConfirmation(){',fnStart);
assert.ok(fnStart>0&&fnEnd>fnStart,'DEV80.2 helper missing');
const source=script.slice(fnStart,fnEnd);
let fresh=true,modal=false,controls=0,params=[];
const overlay={classList:{contains:v=>v==='open'}};
const layer={classList:{contains:v=>modal&&v==='open'}};
const ctx={
 document:{getElementById:id=>id==='scadaOverlay'?overlay:id==='controlConfirmLayer'?layer:null},
 currentControlContext:{packId:'pack_2',bms:'1'},
 currentParameterContext:null,
 scadaWritableViewSignature:'control:pack_2:1:true',
 scadaTelemetryFresh:()=>fresh,
 refreshControlWorkspace:()=>{controls++},
 refreshParameterWorkspace:(p,b,clear)=>{params.push({p,b,clear})}
};
const refresh=vm.runInNewContext(source+'\nscadaRefreshWritableWorkspace',ctx);
refresh();
assert.equal(controls,0,'unchanged healthy workspace must not be redrawn');
fresh=false;refresh();
assert.equal(controls,1,'offline transition must repaint a previously opened control workspace');
assert.equal(ctx.scadaWritableViewSignature,'control:pack_2:1:false');
refresh();refresh();
assert.equal(controls,1,'offline render must not repeat every second');
modal=true;fresh=true;refresh();
assert.equal(controls,1,'confirmation modal cannot be replaced under the operator');
modal=false;refresh();
assert.equal(controls,2,'fresh LIVE after reconnect must re-enable a previously opened control workspace');
ctx.currentControlContext=null;
ctx.currentParameterContext={packId:'pack_2',bms:'1'};
ctx.scadaWritableViewSignature='parameter:pack_2:1:true';
fresh=false;refresh();
assert.equal(params.length,1);
assert.equal(params[0].clear,true,'disconnect must discard unsubmitted parameter drafts');
fresh=true;refresh();
assert.equal(params.length,2);
assert.equal(params[1].clear,false,'reconnection must not discard the newly displayed values');
ctx.currentParameterContext=null;refresh();
assert.equal(params.length,2,'closed workspaces must not update');

// Rendered values and command buttons must not misrepresent retained HA
// state as a live BMS value when offline. This only checks UI; engine write
// protection is already covered separately by DEV80.0 and DEV80.1.
const renderStart=script.indexOf('function renderControlConsole(packId,bms,b){');
const renderEnd=script.indexOf('function openBmsControls(',renderStart);
assert.ok(renderStart>0&&renderEnd>renderStart);
const renderSrc=script.slice(renderStart,renderEnd);
const renderCtx={
 BMS_CONTROL_DEFS:[{key:'display_always_on_switch',label:'LCD',desc:'JK display'}],
 BMS_DRY_STATUS_DEFS:[{key:'dry1',label:'DRY1',desc:'contact',bit:2}],
 readControlState:()=>({available:true,on:true,source:'SETUP · ACTIVE POLLING'}),
 readDryState:()=>({available:true,on:true,source:'LIVE'}),
 scadaWritableBms:()=>false,
 scadaTelemetryFresh:()=>false,
 commandableControl:()=>false,
 getControlCommand:()=>null,
 spParamUi:x=>x,
 controlActionHtml:()=>'<strong>LECTURE</strong>',
 commandStatusHtml:()=>''
};
const render=vm.runInNewContext(renderSrc+'\nrenderControlConsole',renderCtx);
const offline=render('pack_2','1',{});
assert.match(offline,/DONNÉES PÉRIMÉES/);
assert.match(offline,/control-value">—<\/div>/);
assert.doesNotMatch(offline,/control-value">ACTIF<\/div>/,'cached active state must not appear as current');
assert.doesNotMatch(offline,/9 COMMANDES ACCESSIBLES/,'do not claim 9/9 commands while offline');
assert.match(script,/scadaRefreshWritableWorkspace\(\);refreshDryCards\(\)/,'timer updates command workspaces');
assert.match(script,/drafts=clearDrafts\?\{\}:spCaptureParameterDrafts\(\)/,'offline discards stale parameter edits');

console.log('PASS dev80-2-command-workspace-live-refresh.test.cjs');
