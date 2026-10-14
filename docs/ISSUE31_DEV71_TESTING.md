# SmartPhoton Multi-Pack DEV71 candidate — issue #31 test guide

**Status: PUBLIC TEST CANDIDATE, not hardware-validated.** Published 2026-10-14. Based on the operator-supplied DEV70 independent Active Polling engine and 441-node Node-RED flow. Do not confuse this candidate with the older v4.2.100 DEV snapshot; it is preserved in Git branch `backup-before-multipack-dev71-20261014`.

## Goal: two separate physical RS485 buses and two HAOS virtual machines

Two JK-BMS units: master at JK address **0**, second BMS at **2**.

```text
          JK-BMS #1 (address 0)         JK-BMS #2 (address 2)
                | RS485-1                    | RS485-1
                +-------------+--------------+
                              | USB-RS485 (external polling bus)
                              v
                 HAOS VM #1 — DEV71 candidate
                 Multi-Pack / Active Polling 0,2

          JK-BMS #1 (address 0)---------JK-BMS #2 (address 2)
                     RS485-2 (internal JK master/slave communication)
                              |
                      passive RS485/TCP gateway
                              |
                              v
                 HAOS VM #2 — Multi-Pack Broadcasting
                 (same candidate, separate HAOS installation)
```

The two buses must **remain electrically separate**. RS485-2 will continue carrying standard JK communication, observed without introducing a second polling master. The TCP gateway has already been proven in the operator's environment, but **the simultaneous two-VM experiment has not yet been performed**.

## HAOS VM #1 — RS485-1, Active Polling

- `multi_pack_enabled: true`
- `multi_pack_active_polling: true`
- `bms_broadcasting: false`
- `CAN_bus_usage: false` (required by this SmartPhoton engine mode)
- `multi_pack_packs`: one enabled pack with `id: pack_1`, `transport: serial`, `path: /dev/serial/by-id/<your-adapter>`, `bms_addresses: "0,2"`
- Serial line: **115200 baud** with a single USB-RS485 adapter; both RS485-1 ports are connected in parallel on this bus.
- Alternative: `bms_addresses: "auto"` scans JK addresses `0..15` after manual mode is validated.

### HAOS VM #2 — RS485-2, Multi-Pack Broadcasting

- `multi_pack_enabled: true`
- `multi_pack_active_polling: false`
- `bms_broadcasting: true`
- `multi_pack_packs`: one enabled pack with `id: pack_1`, `transport: tcp`, `gateway_ip_port: "<your-gateway-ip>:<port>"`.
- The gateway must passively forward the ongoing JK traffic; **no active queries** from VM #2 on RS485-2.
- For the test, prefer separate MQTT brokers (or otherwise verify that topics and Home Assistant MQTT Discovery unique IDs do not collide).

Both modes are supported by this development codebase, but running on independent VMs is important for the comparison. This is **not** a claim that both bus modes can be attached to one configured addon instance or that the Gateway alone guarantees passive listening.

## Test sequence

1. Back up both HAOS instances, add-on configuration, flows, and MQTT Discovery state. Do **not** run JK-BMS-MONITOR alongside the active polling VM on RS485-1.
2. Install DEV71 only on the designated test HAOS. Begin with **read-only** measurements; do not enable configuration writes.
3. Validate SETUP/STATIC/LIVE on BMS_0 and BMS_2 separately, checking CRC, voltages, cell data, temperature and stable target identification.
4. Confirm that the Broadcasting VM continues to receive normal JK traffic on RS485-2 and compare the two data streams, allowing for time differences.
5. After read-only success, enable setting changes *temporarily* and test LCD ON/OFF for one BMS at a time; confirm feedback and physical outcome on the correct BMS. Avoid MOSFET/critical protection settings in initial tests.
6. Check auto address discovery `0..15`, MQTT reconnect/discovery, SCADA displays, alarms, aggregator and 24-hour stability. Record failures and restore previous settings after tests.

## Offline tests completed, limits

- Simulated Modbus JK ACK, exception/CRC, out-of-range rejection and target address 0.
- Simulated TCP and fragmented/echoed Serial with BMS 0+2, readback-confirmed LCD/DRY commands, stray-response isolation and auto discovery; regression 1+2.
- 441 Node-RED IDs and wire mappings preserved from DEV70; 11 functions changed.
- **Not yet tested:** live hardware across two buses/VMs, build/install from this GitHub commit, long-term bus behavior, production MQTT Discovery or full SCADA screens. 

## Rollback and reporting

The pre-publication v4.2.100 repository is preserved at branch [backup-before-multipack-dev71-20261014](https://github.com/jean-luc1203/jkbms-rs485-addon-DEVeloppment/tree/backup-before-multipack-dev71-20261014). The complete operator-provided DEV70 sources should also be preserved locally; do not assume v4.2.100 is a direct runtime downgrade path for 1.0.0-dev71.

Please attach anonymized logs and relevant request/response frames to [issue #31](https://github.com/jean-luc1203/jkbms-rs485-addon/issues/31). Do not post MQTT passwords, premium keys, tailscale authentication, public IPs or live battery credentials.
