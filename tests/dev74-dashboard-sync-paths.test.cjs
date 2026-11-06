'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sync = fs.readFileSync(path.join(__dirname, '..', 'rootfs/etc/node-red/dashboard_sync.js'),'utf8');
const beforeSocket = sync.split('const ws = new WebSocket(wsUrl);')[0];
assert(beforeSocket.includes('const urlPath = expectedPath || declaredPath;'), 'dashboard_sync.js layout changed');

function resolve(action, filePath) {
  let exited = null;
  const ctx = {
    process: {argv: ['node','dashboard_sync.js',action,filePath],env:{SUPERVISOR_TOKEN:'fake-test-token'},exit(code){exited=code;throw Error('EXIT '+code);}},
    require(name) {
      if (name === 'fs') return {existsSync:()=>false};
      if (name === 'path') return path;
      throw Error('Unexpected require '+name);
    },
    console:{error:()=>{}},WebSocket:function(){}
  };
  try {
    const value = vm.runInNewContext(beforeSocket + '\n({urlPath,expectedPath})',ctx,{timeout:2000});
    return {value,exited};
  } catch(e) {
    if (String(e.message).startsWith('EXIT ')) return {value:null,exited};
    throw e;
  }
}
for (const [file,url] of [
  ['smart_jkbms_glow.json','smart-jkbms-glow'],
  ['smart_jkbms_scada.json','smart-jkbms-scada'],
  ['smart_jkbms_multipack.json','smart-jkbms-multipack']
]) {
  const result = resolve('delete','/config/dashboards/'+file);
  assert.equal(result.exited,null,file+' should not fail on missing dashboard config');
  assert.equal(result.value.urlPath,url);
  assert.equal(result.value.expectedPath,url);
}
assert.equal(resolve('delete','/config/dashboards/unrecognized.json').exited,1);
console.log('PASS: DEV74 dashboard delete resolves Glow/SCADA even without JSON on first startup');
