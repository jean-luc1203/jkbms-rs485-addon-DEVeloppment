'use strict';
// DEV81.1 issue #166: TCP Broadcasting watchdog isolation regression tests.
// Offline only: no sockets, MQTT, HAOS, serial device or BMS commands.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const flows = JSON.parse(fs.readFileSync('rootfs/etc/node-red/flows.json', 'utf8'));
const byName = new Map(flows.map(n => [n.name, n]));
function storage(data = {}) {
    const map = new Map(Object.entries(data));
    return { get: k => map.get(k), set: (k, v) => map.set(k, v) };
}
function watchdog(i, globals, lastAgeMs, override = {}) {
    const name = i === 1 ? 'Watchdog – check timeout' : 'Pack ' + i + ' watchdog check';
    const n = byName.get(name);
    assert.ok(n && n.type === 'function', 'missing watchdog ' + name);
    const lastKey = i === 1 ? 'lastDataTs' : 'lastDataTs_pack_' + i;
    const saved = lastAgeMs === null ? 0 : Date.now() - lastAgeMs;
    const flow = storage({ [lastKey]: saved, ...override });
    const warnings = [];
    const node = { warn: message => warnings.push(String(message)) };
    const result = new Function('msg', 'node', 'flow', 'context', 'global', 'Buffer', n.func)(
        {}, node, flow, storage(), storage(globals), Buffer);
    return { result, flow, lastKey, warnings };
}
let scenarioCount = 0;
for (let i = 1; i <= 5; i++) {
    const defs = {};
    for (let k = 1; k <= 5; k++) {
        defs['pack_' + k] = {
            transport: 'tcp',
            host: '192.0.2.' + k,
            port: 5000 + k
        };
    }
    const base = {
        multi_pack_enabled: true,
        bms_broadcasting: true,
        jkbmsActiveRequested: false,
        jkbms_active_polling_enabled: false,
        jkbms_pack_defs: defs
    };
    const success = watchdog(i, base, 130000);
    scenarioCount++;
    assert.ok(Array.isArray(success.result) && success.result.length === 2);
    assert.equal(success.result[0].action, 'close');
    assert.equal(success.result[0].host, '192.0.2.' + i);
    assert.equal(success.result[0].port, 5000 + i);
    assert.equal(success.result[0].pack_id, 'pack_' + i);
    assert.equal(success.result[1].pack_id, 'pack_' + i);
    assert.equal(success.result[1].payload, 'reconnect');
    assert.equal(success.flow.get(success.lastKey), 0);
    assert.equal(success.warnings.length, 1);

    const forbidden = [
        { ...base, multi_pack_enabled: false },
        { ...base, bms_broadcasting: false },
        { ...base, jkbmsActiveRequested: true },
        { ...base, jkbms_active_polling_enabled: true },
        { ...base, jkbms_pack_defs: {} },
        { ...base, jkbms_pack_defs: { ['pack_' + i]: { transport: 'serial', path: '/dev/ttyUSB0' } } }
    ];
    for (const config of forbidden) {
        const x = watchdog(i, config, 130000);
        scenarioCount++;
        assert.equal(x.result, null, 'must never close when mode/transport is forbidden');
        assert.equal(x.warnings.length, 0);
    }
    const early = watchdog(i, base, 15000);
    scenarioCount++;
    assert.equal(early.result, null, 'avoid early TCP reconnect');
    const unknown = watchdog(i, base, null);
    scenarioCount++;
    assert.equal(unknown.result, null, 'avoid reconnect before first valid frame');

    const other = i === 1 ? 2 : 1;
    const anotherKey = other === 1 ? 'lastDataTs' : 'lastDataTs_pack_' + other;
    const isolated = watchdog(i, base, 15000, { [anotherKey]: Date.now() - 130000 });
    scenarioCount++;
    assert.equal(isolated.result, null, 'another pack outage must not trigger this watchdog');
}
console.log('PASS dev81-1-issue166-watchdog.test.cjs (' + scenarioCount + ' scenarios)');
