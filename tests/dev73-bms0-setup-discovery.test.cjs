'use strict';

// Run: node tests/dev73-bms0-setup-discovery.test.cjs
// Mock only the Node-RED function's context. Nothing here opens RS485,
// connects to MQTT, changes HA entities, or writes to a BMS.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const file = path.join(__dirname, '..', 'rootfs', 'etc', 'node-red', 'flows.json');
const flows = JSON.parse(fs.readFileSync(file, 'utf8'));
const target = flows.find(n => n.type === 'function' && n.id === 'a473000000000012');
assert.ok(target, 'Missing expected Active Polling SETUP discovery node');
assert.equal(target.name, 'Active Polling SETUP discovery');
const script = new vm.Script('(function () {\n' + target.func + '\n})', { filename: 'Active Polling SETUP discovery' });

function harness(opts = {}) {
    const settings = new Map(Object.entries({
        multi_pack_enabled: true,
        jkbms_active_polling_enabled: true,
        jkbms_mqtt_connected: true,
        ...opts
    }));
    const flowState = new Map();
    const logs = [];
    const global = {
        get: k => settings.get(k),
        set: (k, v) => settings.set(k, v)
    };
    const flow = {
        get: k => flowState.get(k),
        set: (k, v) => flowState.set(k, v)
    };
    const node = {
        warn: s => logs.push(String(s)),
        debug: s => logs.push(String(s))
    };
    function run(address, pack = 'pack_1') {
        const msg = {
            bms_numero: address,
            pack_id: pack,
            pack_name: 'Bus RS485-1',
            bus_id: 'bus_1',
            payload: {
                max_charge_current_A: 80,
                total_battery_capacity_Ah: 280,
                Device_address_N: address,
                display_always_on_switch: true
            }
        };
        const execute = script.runInNewContext({ msg, global, flow, node }, { timeout: 2000 });
        const result = execute();
        if (!result) return [];
        assert.ok(Array.isArray(result) && Array.isArray(result[0]), 'Expected MQTT message list');
        return result[0];
    }
    return { settings, flowState, logs, run };
}

function discovery(messages, domain, id, key) {
    const topic = 'homeassistant/' + domain + '/' + id + '/' + key + '/config';
    const msg = messages.find(m => m.topic === topic && m.payload);
    assert.ok(msg, 'Missing retained discovery topic: ' + topic);
    assert.equal(msg.retain, true);
    return JSON.parse(msg.payload);
}
function testActivePollingZero() {
    const h = harness();
    const msgs = h.run(0);
    const config = discovery(msgs, 'number', 'pack_1_BMS_0_device', 'pack_1_bms_0_bms_max_charge_current');
    assert.equal(config.object_id, 'pack_1_bms_0_bms_max_charge_current');
    assert.equal(config.default_entity_id, 'number.pack_1_bms_0_bms_max_charge_current');
    assert.equal(config.command_topic, 'jkbms/pack_1/BMS_0/control/max_charge_current/set');
    assert.equal(config.state_topic, 'jkbms/pack_1/BMS_0/control/max_charge_current/state');
    assert.ok(msgs.some(m => m.topic === config.state_topic && m.payload === 80));
    assert.equal(h.flowState.get('apSetupSent_pack_1_BMS_0'), true);
    assert.equal(h.flowState.has('apSetupSent_pack_1_BMS_master'), false);
    assert.ok(!msgs.some(m => m.topic.includes('BMS_master') || m.topic.includes('bms_master')));
    assert.ok(h.logs.some(s => s.includes('Setup INITIAL') && s.includes('BMS 0')));
    const addressEntity = discovery(msgs, 'sensor', 'pack_1_BMS_0_device', 'pack_1_bms_0_bms_device_address');
    assert.equal(addressEntity.state_topic, 'jkbms/pack_1/BMS_0/control/bms_device_address/state');
}

function testReconnectRepublishesZero() {
    const h = harness({ jkbms_mqtt_connected: false });
    const initial = h.run(0);
    assert.ok(initial.some(m => m.topic.includes('/number/')));
    h.settings.set('jkbms_mqtt_connected', true);
    h.flowState.set('forceSetupRepublish_pack_1_BMS_0', true);
    const reissued = h.run(0);
    const obj = discovery(reissued, 'number', 'pack_1_BMS_0_device', 'pack_1_bms_0_bms_max_charge_current');
    assert.equal(obj.command_topic, 'jkbms/pack_1/BMS_0/control/max_charge_current/set');
    assert.equal(h.flowState.get('forceSetupRepublish_pack_1_BMS_0'), false);
    assert.equal(h.flowState.get('apMigrationCleanup_v4_2_89_pack_1_BMS_0'), true);
    assert.ok(h.logs.some(s => s.includes('Setup FORCÉ') && s.includes('BMS 0')));
    assert.equal(h.run(0).length, 0, 'A stable repeated SETUP should not republish unchanged values');
}

function testOtherAddressesAndPackIsolation() {
    const h = harness();
    const m2 = h.run(2);
    discovery(m2, 'number', 'pack_1_BMS_2_device', 'pack_1_bms_2_bms_max_charge_current');
    const otherPack = h.run(0, 'pack_2');
    discovery(otherPack, 'number', 'pack_2_BMS_0_device', 'pack_2_bms_0_bms_max_charge_current');
    assert.equal(h.flowState.get('apSetupSent_pack_1_BMS_2'), true);
    assert.equal(h.flowState.get('apSetupSent_pack_2_BMS_0'), true);
}

function testLegacyAndBroadcastMasterIdentity() {
    const broadcasting = harness({ jkbms_active_polling_enabled: false });
    const broadcastMsgs = broadcasting.run(0);
    const bcast = discovery(broadcastMsgs, 'number', 'pack_1_BMS_master_device', 'pack_1_bms_master_bms_max_charge_current');
    assert.equal(bcast.state_topic, 'jkbms/pack_1/BMS_master/control/max_charge_current/state');
    const legacy = harness({ multi_pack_enabled: false, jkbms_active_polling_enabled: false });
    const legacyMsgs = legacy.run(0);
    const legacyConfig = discovery(legacyMsgs, 'number', 'BMS_master_device', 'bms_master_bms_max_charge_current');
    assert.equal(legacyConfig.state_topic, 'BMS_master/control/max_charge_current/state');
}

function main() {
    assert.equal(flows.length, 441, 'Node-RED node count must remain unchanged');
    assert.equal(flows.filter(n => n.type === 'function').length, 103);
    testActivePollingZero();
    testReconnectRepublishesZero();
    testOtherAddressesAndPackIsolation();
    testLegacyAndBroadcastMasterIdentity();
    console.log('PASS: DEV73 Active Polling BMS 0 SETUP discovery, reconnect, pack isolation and legacy master naming');
}
main();
