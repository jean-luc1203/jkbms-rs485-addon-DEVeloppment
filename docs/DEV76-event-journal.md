# DEV76 — GLOW persistent event journal (work in progress)

## Current implementation: collector only

- One Node-RED Function: `DEV76 private event journal` (`76a0000000000003`), sourced from `rootfs/etc/node-red/glow_journal_collector.js`.
- Subscribes to existing retained SCADA audit snapshots at `jkbms/scada/audit/snapshot`, JK-BMS hardware alarm states at `jkbms/+/+/alarm/active`, and existing per-pack aggregates at `jkbms/+/aggregate`.
- Reuses already authoritative audit data. Commands stay `sent` until SCADA's readback confirms them; the journal updates the same event rather than recording a second confirmed command.
- Imports SCADA lifecycle entries for `PACK_OFFLINE`, `TEMPERATURE_HIGH` and `CELL_DELTA_HIGH`; active and cleared transitions have different stable event IDs.
- Hardware MQTT state is treated as baseline on first observation and for retained messages, not a historical incident. A subsequent non-retained ON/OFF change creates an event.
- Per-BMS balancing ON/OFF and per-pack charge/idle/discharge state changes are derived from Step 13E aggregates after 10 seconds of stable readings. The initial/retained snapshot is only a baseline; absolute current threshold is 3 A. This cannot recover transitions lost while the collector was stopped.
- Private isolated Node-RED `glowJournal` context store key `jkbms_glow_journal_v1` (localfilesystem; verify on HAOS Test). Maximum 250 events or 30 days; oldest pruned. Minimal event fields only.
- No new MQTT Discovery entity, no retained journal topic, no public `/local/` JSON, no HTTP endpoint, no BMS command write.
- Repeated hardware telemetry doesn't rewrite the context on every 3-second poll; same-state baseline refresh is limited to once an hour.

## Important limitations

1. **GLOW's journal viewer is implemented but not yet installed or tested on HAOS.** It requires the additional custom HA integration; DEV75.7.1 still displays its original history-unavailable notice.
2. Durability depends on the separate Node-RED `localfilesystem` store and its flush behavior; power loss may lose the last few seconds.
3. The SCADA snapshot exposes a bounded window (up to 60 recent commands, 40 cleared alarms and 20 active alarms); the collector cannot reconstruct older missing events from a snapshot. Its own store retains events after ingestion.
4. Source events are per-pack for SCADA diagnostic lifecycle; the individual BMS identity is available only for SCADA commands and hardware alarm topics.
5. Balancing and charge/discharge transitions now have source mapping and a 10-second debounce; thresholds and edge cases still require HAOS validation, including retained replay and stale-pack recovery.
6. No claims of event-history completeness across power loss, long disconnection or a newly installed collector.

## GLOW authorization boundary — assessed 2026-11-03

The current add-on has `ingress: false`, `host_network: true`, and Node-RED port 1891 exposed. Therefore an `http in` Node-RED endpoint at port 1891, even if linked only inside GLOW, is **not** an authenticated journal endpoint. It would leak the private audit to anyone with network access to that port. Neither hiding an URL, relying on Origin/Referer, nor matching an X-Ingress header secures the endpoint. Do **not** create such an endpoint.

The current GLOW iframe is served from Home Assistant `/local/` and receives the authenticated HA frontend session via `hass.connection`; however, the HA frontend WebSocket API has no automatically provided command for reading Node-RED's private context. An authorization-aware bridge is required.

Candidate approaches requiring engineering and tests:

1. Prefer a dedicated Home Assistant integration with a custom **read-only WebSocket command**, using the user's HA session and HA permission checks. It can request bounded journal results from the add-on through an internal authenticated channel, without putting full audit records into entity attributes or the public web directory. This adds an integration packaging and maintenance requirement that must be evaluated.
2. Alternatively, redesign GLOW to be served through Home Assistant **Ingress** and move its private journal API behind that same ingress boundary. This requires proving that the underlying API is not reachable directly via the existing host-network Node-RED port; merely setting `ingress: true` while leaving a public API on 1891 does not achieve this.

No option is implemented yet, so the GLOW Journal continues to display the honest unavailable notice until a secure backend is qualified. We must not pass a Home Assistant access token or broker password to the public JavaScript bundle.

## Restart and replay testing

`tests/dev76-glow-journal.test.cjs` now simulates a fresh Function context supplied with previously persisted data and replays retained hardware/aggregate state and audit snapshots. It checks history preservation, deduplication and lack of invented startup transitions. This is a unit simulation: real Node-RED localfilesystem flush, HAOS filesystem persistence, and backup/restore must still be exercised on HAOS Test.

## DEV76 secure reader prototype (not deployed)

The chosen proof of concept uses an isolated Node-RED `localfilesystem` context store named `glowJournal` instead of the default global context (which may include unrelated private data). The Node-RED configuration is:

- `dir: /config/smartphoton_jkbms_multipack`
- `base: glow-journal-store`
- `flushInterval: 5` (seconds)

Node-RED's documented localfilesystem layout places its global file at:

`/config/smartphoton_jkbms_multipack/glow-journal-store/global/global.json`

This is a file in the shared HA `/config` tree, NOT in `/config/www` and NOT served by Node-RED. It should contain only the bounded journal context key `jkbms_glow_journal_v1`, isolated from other Node-RED variables.

A packaged custom integration is present in `homeassistant/custom_components/smartphoton_glow_journal/`. It registers one read-only `smartphoton_glow_journal/list` WebSocket command. `require_admin` enforces access to authenticated Home Assistant administrators. Its server-side reader loads only the fixed isolated JSON file in an executor, checks a 1 MiB file limit, returns a whitelist of event fields, and applies bounded filters and a maximum 250-event response. It is not an HTTP endpoint, does not use 1891, and does not write to disk.

The `glow/journal.js` frontend uses GLOW's existing `wsSend` authenticated HA session to request this command; it adds date, pack, BMS, and category filters in FR/EN/DE and a filtered history in the per-BMS Alarms page. If the integration is missing, unauthorized, or the journal file has not yet been created, the frontend displays an explicit unavailable notice. No fake events are generated.

### Test-only manual installation on HAOS Test (later, after local tests)

1. Copy the entire directory `homeassistant/custom_components/smartphoton_glow_journal` from the checked-out DEV76 branch into HAOS Test's `/config/custom_components/smartphoton_glow_journal` (outside of `www`). Do not perform these steps on production.
2. Add this separate key to HAOS Test's `/config/configuration.yaml`:

   ```yaml
   smartphoton_glow_journal:
   ```

3. Run a Home Assistant configuration check and restart **Home Assistant Core** on HAOS Test to register the custom WebSocket command. The integration is not installed by simply updating the add-on.
4. Deploy the DEV76 add-on candidate only after full unit regression and safety review. At startup the named Node-RED store will create its own isolated context file after the first event or baseline write. Note that the backend file may lag in-memory data by about five seconds.
5. Open the GLOW journal as an HA administrator. Confirm read-only access, missing-file display, event filters, per-BMS history, and that an ordinary non-admin account cannot read the journal.
6. Check restart and restore on HAOS Test: recorder remains unaffected, retained MQTT replay creates no false transition, and events persist.

Do not attempt to expose the isolated JSON via `/local` or create an unauthenticated Node-RED HTTP route.

### Release limitation

A separate custom integration is a **new deployment dependency**. Before any production release, decide whether it will be included in the installer/upgrade process (with safe rollback) or clearly documented as an optional GLOW Premium feature. The existing addon must not silently modify an administrator's `configuration.yaml`.

## Next steps before DEV76 qualification

- Verify the **admin-only** HA WebSocket reader on HAOS Test; confirm authenticated access and non-admin denial. Keep the isolated context file outside `/local/`.
- Build journal pages and filters in FR/EN/DE: time, site, BMS, category, status; include source and recording coverage.
- Qualify balancing and charge/discharge transitions on real and simulated BMS; extend hardware alarm details and acknowledgement semantics without guessing causes.
- Test persistence over Node-RED restart and HAOS restart, retained-state replays, data restoration and limits.
- Run the full existing test suite; qualify on HAOS Test .184; production .217 remains untouched.

## Test

```bash
node tests/dev76-glow-journal.test.cjs
```

No HAOS installation or version bump in this initial backend-only commit.
