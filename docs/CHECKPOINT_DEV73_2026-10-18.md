# SmartPhoton JK-BMS Multi-Pack — checkpoint DEV73 (2026-10-18)

> **Permanent handoff / context**. This is the canonical project checkpoint for restarting the development in a new ChatGPT conversation. It intentionally contains **no** MQTT passwords, Premium SPV2 licence keys, tokens or other secrets. Latest code must be verified from GitHub before further edits.

## Repositories, branches and publishing rules

- DEV repository: https://github.com/jean-luc1203/jkbms-rs485-addon-DEVeloppment (case sensitive).
- Original stable/Legacy repository: https://github.com/jean-luc1203/jkbms-rs485-addon — **do not edit** as part of DEV73.
- DEV `main` was upgraded to **1.0.0-dev72.2** by merged PR #10: https://github.com/jean-luc1203/jkbms-rs485-addon-DEVeloppment/pull/10 ; merge commit `cb0b30256a5dddf90c5a2c4b8d896c2b3b113d2f`.
- Development branch for the next fix: **`fix/dev73-bms0-setup-discovery`**, branched from DEV72.2 `main`. Candidate version **1.0.0-dev73** only on this branch until proven.
- Workflow agreed with user: **make changes via the GitHub connector on a dedicated branch, install candidate branch directly from HAOS, user tests physical equipment, merge into `main` only with explicit authorization**. This avoids maintaining a separately modified local source tree. GitHub Desktop may be needed temporarily for binary assets.
- GitHub HA add-on branch URL: `https://github.com/jean-luc1203/jkbms-rs485-addon-DEVeloppment#fix/dev73-bms0-setup-discovery`.
- Do **not** push device-specific configuration, Premium keys, MQTT credentials or log secrets to GitHub.

## Hardware, HAOS and validated physical topology

**HAOS Test — 192.168.0.184:**
- Home Assistant OS 18.3 / Core 2026.10.2 / Supervisor 2026.10.2.
- JK **RS485-1**, direct USB/RS485, `/dev/serial/by-id/usb-1a86_USB_Serial-if00-port0`.
- Two real JK BMS at physical JK UART1/RS485-1 **addresses 0 and 2** on one bus.
- DEV72.1 Active Polling options: `multi_pack_enabled: true`, `multi_pack_active_polling: true`, `bms_broadcasting: false`, `CAN_bus_usage: false`; `pack_1`, `transport: serial`, `bms_addresses: "0,2"`, `non_broadcasting_data_interval_s: 3`.
- Both BMS return verified LIVE `0x1620`, SETUP `0x161E`, STATIC `0x161C` frames with ~42–45 ms response time and valid CRC/address. Both appear online on SCADA and MQTT/HA discovery; the physical BMS 0 address displays correctly in the detailed SCADA screen.
- **Problem under investigation:** the BMS 0 numeric SETUP entities were **missing** from HAOS: dozens of "Entité non trouvée" fields on its *Paramètres* view. `homeassistant/number/pack_1_bms_master...` did not exist and `jkbms/pack_1/BMS_master` was absent. BMS 0 did have LIVE/STATIC sensors, dedicated switches and DRY controls under `jkbms/pack_1/BMS_0/control`, while BMS 2 had more numeric entities.
- MQTT topics use `jkbms/pack_1/BMS_0`, `jkbms/pack_1/BMS_2`, and MQTT Discovery `homeassistant/...`. Compare `homeassistant/number` retained config topics and HA entities for BMS 0 vs 2.

**HAOS Production — 192.168.0.217:**
- Independently listens to **RS485-2 Broadcasting** from these JK BMS through a TCP/IP RS485 gateway `192.168.0.131:8887`.
- Multi-Pack single pack, `multi_pack_active_polling: false`, `bms_broadcasting: true`, `transport: tcp`. Two real BMS online.
- It has an installed local DEV72.1 add-on and an installed GitHub DEV instance; **never start more than one instance on the same HAOS**. Do not interrupt production Broadcasting while testing RS485-1.
- Production and test HAOS have their own MQTT broker configurations; avoid reusing MQTT Discovery identities across brokers.

## Completed DEV72.2 SCADA packaging

- Initial fresh-HAOS `smart-jkbms-scada/process` returned 404: Home Assistant created Lovelace registration but referenced missing `/local/smartphoton_jkbms_multipack/scada/index.html`.
- Exact known-good production assets were committed to `rootfs/etc/smartphoton_jkbms_multipack/www/scada/index.html` and `.../assets/{bms-default.webp,pack-default.webp}`.
- `rootfs/etc/s6-overlay/s6-rc.d/init-nodered/run` now copies the three files idempotently into `/config/www/smartphoton_jkbms_multipack/` on add-on start, preserving unrelated files.
- Validated by installing **DEV72.2 SCADA TEST** from branch on HAOS Test: the files appeared, direct HTML page displayed (DEMO mode when not in HA), and after restarting the licensed DEV72.1 the Lovelace embedded SCADA displayed actual **single pack / real physical BMS 0+2**, live data, normal diagnostics.
- Merged PR #10 to `main`; corrected README and CHANGELOG. Preserve this fix in DEV73.

## DEV73 source-level diagnosis and targeted change

- `rootfs/etc/node-red/flows.json`: **441 nodes, 103 Function nodes**.
- Only modified code node: **`Active Polling SETUP discovery`**, id **`a473000000000012`**. Do not change `Setup To MQTT` which handles Legacy/Broadcasting and legitimately uses `master`.
- In DEV72.2, `let slaveIdStr = (bmsAdresse === 0) ? "master" : String(bmsAdresse);` incorrectly remapped physical JK address 0 to `master`, while the MQTT reconnect/reset code used flow keys `apSetupSent_pack_1_BMS_0` and `forceSetupRepublish_pack_1_BMS_0`.
- DEV73 fixes the identity to `BMS_0` only when `multi_pack_enabled === true` and `jkbms_active_polling_enabled === true`. Legacy/Broadcasting still maps 0 to `BMS_master`. The change is confined to the single function's string, leaving all node IDs/wires and the independent `active-polling.js` engine unchanged.
- Synthetic Node-RED function execution **passed** scenarios: Active Polling 0, addressed BMS 2, MQTT reconnect forced SETUP rediscovery for BMS 0, different pack IDs, Multi-Pack Broadcasting 0→master, Legacy 0→master. A test script was committed at `tests/dev73-bms0-setup-discovery.test.cjs`. **Physical test has not yet been performed.**

## Next steps on HAOS Test (read-only verification first)

1. **Do not touch production**. Back up test HAOS; stop the currently running test add-on DEV72.1 and turn off its watchdog/autostart before starting a DEV73 candidate. Do not run two versions simultaneously: USB serial, port 1891, MQTT Discovery IDs and `/config/smartphoton_jkbms_multipack/` are shared.
2. Add a branch repository via `https://github.com/jean-luc1203/jkbms-rs485-addon-DEVeloppment#fix/dev73-bms0-setup-discovery`. Install version `1.0.0-dev73`, configure the same single physical serial pack with `bms_addresses: "0,2"`. A separate add-on may require a new Premium licence identity; MQTT Discovery works without Premium. **Do not share licence keys**.
3. Once MQTT connects, wait for `Setup INITIAL envoyé pour BMS 0` or `Setup FORCÉ renvoyé pour BMS 0`, alongside BMS 2. Confirm in MQTT Explorer `homeassistant/number/pack_1_BMS_0_device/...` (the exact control discovery prefix) and state under `jkbms/pack_1/BMS_0/control/.../state`. Example numeric entity `number.pack_1_bms_0_bms_max_charge_current`.
4. Check Home Assistant's BMS 0 "Paramètres" page: numeric entities should appear with **readback values** consistent with BMS application, and BMS 2 and all dedicated switches must still work. No actual write/SET commands, particularly no charge/discharge MOS modifications, until explicitly authorized.
5. Verify RS485-2 Broadcasting on production remains healthy and `BMS_master` identity unchanged there. Observe MQTT reconnection, restart discovery, duplicates, lag and HA Recorder errors.
6. If the real tests pass, user must authorize merging DEV73 PR into `main`. If problems occur, stop candidate and restart the known-good DEV72.1 on HAOS Test (note that candidate may remove Premium dashboard registrations when unlicensed; restarting the licensed add-on recreates them).
7. After validation, update README, CHANGELOG, docs/ISSUE31_DEV71_TESTING.md with confirmed physical tests only; preserve this checkpoint for new conversations.

## Nonblocking issues / precautions

- Stale Node-RED serialconfig placeholder errors `/dev/JKBMS-Fake`, Pack2..Pack5, occur at startup without preventing acquisition.
- Brief MQTT connection retry during startup later succeeds.
- `Encrypted credentials not found` appears in Node-RED startup; not the root cause here.
- SCADA Recorder audit attributes fixed in DEV70.1 and preserved DEV72.2; monitor for max 16,384-byte attributes and no 30s snapshot log spam.
- Address 0 still appeared as `master` in a global aggregation log for Active Polling; separate possible identity cleanup must be assessed, not conflated with missing numeric SETUP entities.
- Disable automatic upgrades on production during candidate testing unless planned.
- Persistent Node-RED path: `/config/smartphoton_jkbms_multipack/` (Legacy separate `/config/smartphoton_jkbms/`). The packaged `flows.json` intentionally overwrites the persistent flow on startup, per maintainer preference.
