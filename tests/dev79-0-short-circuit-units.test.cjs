'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

const flows = JSON.parse(fs.readFileSync('rootfs/etc/node-red/flows.json', 'utf8'));
const scada = fs.readFileSync('rootfs/etc/smartphoton_jkbms_multipack/www/scada/index.html', 'utf8');
const glow = fs.readFileSync('rootfs/etc/smartphoton_jkbms_multipack/www/glow/index.html', 'utf8');
const node = (id) => {
  const found = flows.find(n => n.id === id);
  assert.ok(found, 'Missing Node-RED node ' + id);
  return found;
};

// JK SETUP frame offset 134 is a raw integer count of microseconds.
// Preserve its historical _S field name and all MQTT/Discovery identifiers.
for (const id of ['e0beba39da568e23', 'a47300000000ff01']) {
  const parser = JSON.stringify(node(id));
  assert.match(parser, /short_circuit_protection_delay_S/);
  assert.match(parser, /"offset":134/);
}

// Both polling/broadcast SETUP discovery paths must announce the right unit.
for (const [id, expected] of [
  ['2321fa6d9d473fda', 1],
  ['a473000000000012', 2],
]) {
  const source = node(id).func;
  const corrected = source.match(/short_circuit_protection_delay_S:\s*\{\s*unit:\s*"µs"/g) || [];
  assert.equal(corrected.length, expected, 'SETUP discovery unit count in ' + id);
  assert.doesNotMatch(source, /short_circuit_protection_delay_S:\s*\{\s*unit:\s*"s"/);
}
const audit = node('59a1a00000000002').func;
assert.match(audit, /short_circuit_protection_delay:"µs"/);
assert.doesNotMatch(audit, /short_circuit_protection_delay:"s"/);

assert.match(scada, /key:'short_circuit_protection_delay',label:'Délai court-circuit',desc:'Temporisation de la protection court-circuit',unit:'µs'/);
assert.doesNotMatch(scada, /key:'short_circuit_protection_delay',label:'Délai court-circuit',desc:'Temporisation de la protection court-circuit',unit:'s'/);
// Glow had the correct unit before DEV79. Leave its behavior unchanged.
assert.match(glow, /\['bms_short_circuit_protection_delay','Délai protection court-circuit','µs'/);

console.log('PASS dev79-0-short-circuit-units.test.cjs');
