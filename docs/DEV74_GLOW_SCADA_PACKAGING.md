# DEV74 — Glow + SCADA in SmartPhoton Multi-Pack (HAOS Test candidate)

## Scope and isolation

- Branch: `feature/dev74-glow-scada-dual-dashboard` (based on DEV73, not merged).
- Add-on: `1.0.0-dev74`; **HAOS Test 192.168.0.184 only**.
- HAOS Production 192.168.0.217 and the legacy standalone `/config/www/jkbms-dashboard-glow.html` are **not** changed.
- This candidate includes the DEV73 BMS 0 SETUP Discovery correction; it does not change the RS485/CAN transport engine.

## Web assets and dashboard registration

The add-on image includes `rootfs/etc/smartphoton_jkbms_multipack/www/glow/index.html`. On startup, `init-nodered/run` copies it atomically and idempotently to:

```
/config/www/smartphoton_jkbms_multipack/glow/index.html
```

The existing SCADA assets and their independent installation remain untouched. Both dashboards use the existing `dashboard_sync.js` Home Assistant WebSocket integration and the same `dashboard_premium` + Multi-Pack license flags.

| Interface | Dashboard path | Direct HTML path |
|---|---|---|
| SCADA | `/smart-jkbms-scada/process` | `/local/smartphoton_jkbms_multipack/scada/index.html` |
| Glow | `/smart-jkbms-glow/monitor` | `/local/smartphoton_jkbms_multipack/glow/index.html` |

**Licensing caveat:** The Premium check controls **sidebar registration**, not access control on static files served by Home Assistant under `/local`. Do not treat the HTML itself as license-enforced. Genuine license enforcement is a separate release task.

## Glow behavior

- Real Home Assistant data is the default. No simulated measurements are displayed unless the user explicitly adds `?demo=1`.
- When HA iframe can access the frontend session, Glow reuses it. If this fails, the Settings page offers the existing manual WebSocket/token connection; a token is not embedded in the packaged HTML.
- First successful connection: **1 pack + 1 BMS → BMS detail**; **1 pack + several BMS → pack view**; **several packs → overview**. Explicit hash routes are preserved.
- Physical addresses `BMS_0` and `BMS_2` remain distinct.
- BMS writes are **not optimistically applied** in Glow. Service acknowledgement means the command was transmitted, not that the JK hardware accepted it. Check the subsequent Home Assistant state/BMS readback. An actual hardware acknowledgement workflow is still future work.
- The existing standalone Glow on production remains independent.

## Tests and acceptance

1. In the candidate clone, run `node tests/dev73-bms0-setup-discovery.test.cjs` and `node tests/dev74-glow-dashboard.test.cjs`.
2. Run `bash -n rootfs/etc/s6-overlay/s6-rc.d/init-nodered/run`.
3. Confirm only DEV74 runs on HAOS Test. Do not start DEV72/DEV73 concurrently on the same ports, USB, MQTT IDs or shared userDir.
4. Back up/snapshot HAOS Test before installing candidate. Add the separate repository `https://github.com/jean-luc1203/jkbms-rs485-addon-DEVeloppment#feature/dev74-glow-scada-dual-dashboard`.
5. Start DEV74, verify `SmartPhoton Glow available under /local/smartphoton_jkbms_multipack/glow/` in logs.
6. Verify both direct HTML URLs return HTTP 200, then open the **two HA sidebar dashboards** with a valid Premium Multi-Pack license. Check BMS 0 and 2 LIVE and SETUP.
7. Test Glow routing for a one-pack configuration; multi-pack overview with simulator packs; no fake data when HA connection is unavailable; switching themes and viewing history.
8. Do **not** write MOS/protection parameters merely to test the dashboard. Use a controlled, safe setting with Bluetooth verification only if deliberately approved.
9. Confirm HAOS Production .217 Broadcasting remains unchanged.

## Known limitations

- The iframe automatic HA session reuse must be tested in the actual HA frontend. Browsers, iframe sandbox rules and HA updates may affect it. If unavailable, manual token connection remains an option.
- Glow's existing long-term history and diagnostics depend on available HA Recorder entities; the UI does not manufacture historical readings in real mode.
- Premium license migration from Legacy to Multi-Pack and secure static-asset authorization are outside this DEV74 candidate.
- A dashboard registration is not evidence that the corresponding HTML asset was copied; verify both.
