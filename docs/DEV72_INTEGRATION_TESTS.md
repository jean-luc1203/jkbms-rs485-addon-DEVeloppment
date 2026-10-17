# DEV72 integration candidate — Issue #31 + SCADA Recorder hotfix

> **Status: candidate; combined DEV72 not yet validated on physical dual RS485 buses.**
> Base: DEV71 GitHub main (2026-10-14). Recorder patch: DEV70.1 validated on HAOS (2026-10-17).

## Scope and preservation

- **Keep Issue #31:** JK UART1 RS485-1 Active Polling permits addresses **0..15**, including BMS address 0 and nonconsecutive addresses (e.g. 0+2). Automatic scan/manual selection and the strict target/CRC/ACK/SETUP validation remain unchanged.
- **Keep broadcasting:** RS485-2 Broadcasting via independent transport or separate HAOS VM still supported; no changes to its engine.
- **Keep DRY audit for BMS_0:** The DEV71-specific validation in `SCADA Central Audit (dev70)` remains `Number(e.bms_numero)<0` (rather than DEV70.1's earlier `<1`).
- **No transport changes:** `rootfs/etc/node-red/active-polling.js`, IDs, 441 flow nodes, all wires, and all other 101 functions remain unchanged.

## Recorder / audit fix (ported from DEV70.1)

1. HA MQTT Discovery Audit and Diagnostics entities expose bounded summary attributes, not arrays of command/alarm history that exceed Home Assistant Recorder's 16,384-byte attribute limit.
2. The complete bounded SCADA audit remains in Node-RED context and on retained MQTT topic `jkbms/scada/audit/snapshot` (not used as HA state attributes).
3. Audit MQTT Discovery republishing is at most roughly hourly instead of at every 30-second snapshot. The periodic `SCADA audit SNAPSHOT ... -> AUDIT + DIAG mirror` INFO log is removed.
4. The two modified Node-RED functions are `SCADA Central Audit (dev70)` and `BUILD SMARTPHOTON SCADA MENU (dev66)`.

## Acceptance test — avoid replacing known-good DEV70.1 blindly

1. Deploy DEV72 on a **test HAOS VM** using a backup of config, flow, and Node-RED context. Verify version `1.0.0-dev72`, MQTT connection, SCADA/dashboard loading.
2. In an RS485-1 test with JK-BMS address **0 and 2**, validate Active Polling telemetry, MQTT Home Assistant unique identities, precise target mapping and readbacks; test manual/auto scan separately. Reference: [Issue #31 DEV71 test plan](ISSUE31_DEV71_TESTING.md).
3. In a **separate RS485-2 setup or VM**, verify Broadcasting and ensure no cross-bus masters or settings writes.
4. Verify `sensor.smartphoton_jk_bms_multi_pack_audit` and `sensor.smartphoton_jk_bms_multi_pack_diagnostics` update with compact attributes. Check `history_count` is retained while command history arrays are not sent as HA state attributes.
5. Subscribe to `jkbms/scada/audit/snapshot` to confirm detailed history remains available; confirm no cyclic audit INFO logs every 30s.
6. Over at least one hour, check Recorder for *new* `State attributes ... exceed maximum size of 16384 bytes` warnings. Test a BMS 0 DRY audit event and ensure BMS 0 identity is not discarded.
7. Confirm basic Pack/BMS readings and controls continue to work. Record screenshots/logs and then decide whether to merge the DEV72 PR into `main`.

## Test provenance and limits

- **DEV70.1 Recorder** tested in the field on HAOS 192.168.0.217: four packs, ten BMS, both HA sensors updating; no new oversized Recorder warnings observed during the user's test window.
- **DEV71 Issue #31** simulation tests (0+2 and 1+2) reported in its prior changelog; physical two-bus validation pending.
- **DEV72 combined build** currently has static validation only. It is not yet a stable production release.

## Rollback

Keep DEV70.1 on the working HAOS until DEV72's acceptance tests finish. Preserve backups of `config.yaml`, `CHANGELOG.md`, `rootfs/etc/node-red/flows.json` and add-on settings before trial deployment.

## DEV72.1 — Multi-Pack persistent runtime path regression test

- Verify Node-RED startup logs `Node-RED is using userDir = /config/smartphoton_jkbms_multipack/` and `User directory: /config/smartphoton_jkbms_multipack/`.
- Confirm `config.js` resolves `settings.js`, `nodesDir` and `contextStorage.default.config.dir` under the same Multi-Pack directory. Confirm the init-nodered startup script uses this directory for `flows.json`, `version`, and backups.
- Check that existing Multi-Pack persistent context and Node-RED settings are retained. Do not automatically move the unrelated or stale directory `/config/smartphoton_jkbms/` over the Multi-Pack directory.
- The source tree backup under `/addons` does not by itself back up `/config` persistent data; create a separate HAOS backup before rollout.
- HAOS local add-on update dialog can be temporarily disabled following a store reload due to Core update-entity refresh lag. Use the HAOS host CLI `ha apps list`, `ha apps reload` and `ha apps update <actual-local-slug>` (or `ha apps rebuild <actual-local-slug>` when appropriate) if the UI remains stale.
