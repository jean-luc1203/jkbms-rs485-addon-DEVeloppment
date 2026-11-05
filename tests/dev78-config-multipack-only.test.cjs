'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const config = fs.readFileSync(path.join(root, 'config.yaml'), 'utf8');
const flows = JSON.parse(fs.readFileSync(path.join(root, 'rootfs/etc/node-red/flows.json'), 'utf8'));
const sections = config.split(/^schema:\s*$/m);
assert.equal(sections.length, 2, 'options and schema sections must exist');
const optionBlock = sections[0].split(/^options:\s*$/m)[1];
assert.ok(optionBlock, 'options block missing');
const schemaBlock = sections[1];
const rootKeys = text => [...text.matchAll(/^  ([A-Za-z_][\w]*):/gm)].map(m => m[1]);
const optionKeys = rootKeys(optionBlock);
const schemaKeys = rootKeys(schemaBlock);
assert.equal(new Set(optionKeys).size, optionKeys.length, 'duplicate option keys');
assert.equal(new Set(schemaKeys).size, schemaKeys.length, 'duplicate schema keys');
for (const key of optionKeys) {
  assert.ok(schemaKeys.includes(key), 'option absent from schema: ' + key);
}
for (const key of schemaKeys) {
  assert.ok(optionKeys.includes(key), 'schema key missing from defaults: ' + key);
}
for (const key of [
  'legacy_section', 'jkbms_path', 'jkbms_count',
  'use_gateway', 'gateway_ip_port', 'dashboard_mode', 'multi_pack_enabled'
]) {
  assert.ok(!optionKeys.includes(key), 'obsolete top-level option: ' + key);
  assert.ok(!schemaKeys.includes(key), 'obsolete top-level schema entry: ' + key);
}
for (const key of [
  'multi_pack_packs', 'multi_pack_active_polling', 'bms_broadcasting',
  'non_broadcasting_data_interval_s', 'CAN_bus_usage',
  'communication_debug', 'mqttadresse_port', 'mqttuser', 'mqttpass',
  'long_term_statistics', 'Send_bip', 'premium_key',
  'dashboard_language', 'dashboard_custom_cards_installed'
]) {
  assert.ok(optionKeys.includes(key), 'required option missing: ' + key);
}
assert.match(config, /^version: 1\.0\.0-dev79\.3$/m);
assert.match(optionBlock, /^  multi_pack_active_polling: true$/m);
assert.match(optionBlock, /^  bms_broadcasting: false$/m);
assert.match(optionBlock, /^  non_broadcasting_data_interval_s: 3$/m);
assert.match(optionBlock, /^  CAN_bus_usage: false$/m);
assert.match(schemaBlock, /id: "match\(\^pack_\[1-5\]\$\)"/);
assert.match(schemaBlock, /transport: "list\(tcp\|serial\)\?"/);
const configNode = flows.find(node => node.id === 'af582d4d2d8a4a69');
const activeNode = flows.find(node => node.id === 'a47300000000000e');
assert.ok(configNode?.func && activeNode?.func, 'runtime nodes missing');
assert.match(configNode.func, /const multiPackRequested = true/);
assert.match(configNode.func, /global\.set\("multi_pack_enabled", multiPackEnabled\)/);
assert.match(configNode.func, /global\.set\(\s*"use_gateway"/);
assert.match(configNode.func, /global\.set\("jkbms_path", primaryDef\.path\)/);
assert.match(configNode.func, /processedData\.CAN_bus_usage !== true/);
assert.match(activeNode.func, /global\.get\("non_broadcasting_data_interval_s"\)/);
assert.match(configNode.func, /const activePollingRequested = processedData\.multi_pack_active_polling === true/);
assert.match(configNode.func, /global\.set\("jkbms_pack_defs", runtimePackDefs\)/);
for (const lang of ['fr', 'en', 'de', 'ru']) {
  const translation = fs.readFileSync(path.join(root, 'translations', lang + '.yaml'), 'utf8');
  const translatedKeys = [...translation.matchAll(/^  ([A-Za-z_][\w]*):\s*$/gm)].map(m => m[1]);
  assert.equal(new Set(translatedKeys).size, translatedKeys.length, lang + ': duplicate translation keys');
  for (const key of optionKeys) {
    assert.ok(translatedKeys.includes(key), lang + ': missing translation of ' + key);
  }
  for (const key of translatedKeys) {
    assert.ok(optionKeys.includes(key), lang + ': obsolete configuration label ' + key);
  }
}
const initScript = fs.readFileSync(path.join(root, 'rootfs/etc/s6-overlay/s6-rc.d/init-nodered/run'), 'utf8');
assert.doesNotMatch(initScript, /bashio::app\.options?/, 'unsupported Bashio option API must not block startup');
console.log('PASS dev78-config-multipack-only.test.cjs');
