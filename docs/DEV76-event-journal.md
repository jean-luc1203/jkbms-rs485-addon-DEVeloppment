# DEV76.0 — GLOW event journal via SCADA-style MQTT WebSocket (test candidate)

## Architecture

The existing Node-RED collector persists up to **250 events** / **30 days** in its isolated `glowJournal` `localfilesystem` context store, at `/config/smartphoton_jkbms_multipack/glow-journal-store/global/global.json`. Sources are existing SCADA audit snapshots, hardware alarm states, and Step 13E pack aggregates. No new reads or writes to the BMS.

The Function emits a **retained QoS 1** JSON snapshot on `jkbms/glow/journal/snapshot` via the existing MQTT output. Only the most recent **100 events**, with a maximum serialized payload of **64,000 bytes**, are exposed. The wire schema includes `schema_version`, `source`, `generated_at`, `event_count`, `window_count`, `truncated` and `events`. Each event contains only `id,t,cat,lvl,pack,bms,txt,det`. No command payloads, MQTT credentials, operator identifiers or Node-RED global context baselines are published. Events are updated in-place when a command is confirmed; alarm and flow transitions are deduplicated. Pack charge/discharge states use a 3 A threshold and 10-second debounce.

GLOW's `journal.js` uses the same Home Assistant frontend `hass.connection.subscribeMessage` API as SCADA with `{type:'mqtt/subscribe',topic:'jkbms/glow/journal/snapshot'}`. It does not contact the broker itself. The UI exposes FR/EN/DE filters (category, pack, BMS, date) and a read-only per-BMS history. When MQTT subscription is unavailable, it displays an explicit unavailable notice rather than invented zero events. The add-on startup copies both HTML and JavaScript into HAOS `/config/www`.

**No Home Assistant custom integration and no changes to `configuration.yaml` are needed. No Home Assistant Core restart is required for the journal.**

## Access control and limitations

The published snapshot is **NOT admin-only**. Authorization for reading the topic depends on the MQTT broker ACL and Home Assistant's MQTT WebSocket subscription privileges. Any other broker client with permission to subscribe can read the retained snapshot. These rights must be assessed before production deployment. The exposed data is deliberately reduced, but command labels, event details, pack/BMS identifiers and times are still information about the installation. No claim of confidentiality should be made without restrictive broker ACLs. The topic is outside MQTT Discovery and adds no Recorder entities.

The broker retains only the latest snapshot. Node-RED keeps 250 records, but the UI receives at most 100. Earlier 150 records are not queried by GLOW; they remain in the private local context. Snapshot replay after restart must not manufacture changes. Underlying filesystem context flush is asynchronous; recent seconds of history may be lost in a power failure. The current UI displays only the retained window, **not a guaranteed complete 30-day timeline**.

## HAOS Test .184 validation (production .217 excluded)

1. Run every `tests/*.test.cjs` on Pop!_OS and verify zero failures.
2. Save HAOS Test snapshot and note the installed DEV75.7.1 state for rollback.
3. Update the **test installation branch** only after PR qualification; refresh HAOS Test add-on store and update to `1.0.0-dev76.0`. Do not update production.
4. Verify Node-RED starts and that `/local/smartphoton_jkbms_multipack/glow/journal.js` returns 200.
5. Inspect `jkbms/glow/journal/snapshot` through the test MQTT broker: JSON is valid, `retain=true`, size <=64,000 bytes, 100 events max, no secrets.
6. Open the integrated GLOW dashboard and verify journal FR/EN/DE filters, BMS tab, timestamps, no fictitious historical rows and the unavailable state when MQTT permissions are denied.
7. Test command re-read, one real balancing change if feasible, simulated pack flow changes, alarm on/off, persistence after add-on restart and HAOS reboot.
8. Verify Premium gating, Legacy paths, RS485-1 Active Polling and RS485-2 broadcasting compatibility and Recorder impact.
9. Confirm clear rollback to DEV75.7.1, including any retained journal topic cleanup if the feature is removed.

## Safety

The development PR remains draft until the above validations complete. No automatic deployment to HAOS production. No HTTP endpoint is added to port 1891, and the MQTT topic must not be published to Home Assistant Discovery.
