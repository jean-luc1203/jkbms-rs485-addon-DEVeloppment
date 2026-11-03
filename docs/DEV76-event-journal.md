# DEV76 — GLOW persistent event journal (work in progress)

## Current implementation: collector only

- One Node-RED Function: `DEV76 private event journal` (`76a0000000000003`), sourced from `rootfs/etc/node-red/glow_journal_collector.js`.
- Subscribes to existing retained SCADA audit snapshots at `jkbms/scada/audit/snapshot`, JK-BMS hardware alarm states at `jkbms/+/+/alarm/active`, and existing per-pack aggregates at `jkbms/+/aggregate`.
- Reuses already authoritative audit data. Commands stay `sent` until SCADA's readback confirms them; the journal updates the same event rather than recording a second confirmed command.
- Imports SCADA lifecycle entries for `PACK_OFFLINE`, `TEMPERATURE_HIGH` and `CELL_DELTA_HIGH`; active and cleared transitions have different stable event IDs.
- Hardware MQTT state is treated as baseline on first observation and for retained messages, not a historical incident. A subsequent non-retained ON/OFF change creates an event.
- Per-BMS balancing ON/OFF and per-pack charge/idle/discharge state changes are derived from Step 13E aggregates after 10 seconds of stable readings. The initial/retained snapshot is only a baseline; absolute current threshold is 3 A. This cannot recover transitions lost while the collector was stopped.
- Private Node-RED `global` context key `jkbms_glow_journal_v1` (default localfilesystem context store; verify on HAOS Test). Maximum 250 events or 30 days; oldest pruned. Minimal event fields only.
- No new MQTT Discovery entity, no retained journal topic, no public `/local/` JSON, no HTTP endpoint, no BMS command write.
- Repeated hardware telemetry doesn't rewrite the context on every 3-second poll; same-state baseline refresh is limited to once an hour.

## Important limitations

1. **The GLOW browser is not yet connected to the private journal.** The DEV75.7.1 'History unavailable' message remains correct.
2. No own persistent event-log database yet; durability depends on Node-RED's configured `localfilesystem` context store and its flush behavior.
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

## Next steps before DEV76 qualification

- Determine an **authenticated and read-only** route from GLOW to the private server-side journal (do not expose command/audit history via publicly served `/local/`).
- Build journal pages and filters in FR/EN/DE: time, site, BMS, category, status; include source and recording coverage.
- Qualify balancing and charge/discharge transitions on real and simulated BMS; extend hardware alarm details and acknowledgement semantics without guessing causes.
- Test persistence over Node-RED restart and HAOS restart, retained-state replays, data restoration and limits.
- Run the full existing test suite; qualify on HAOS Test .184; production .217 remains untouched.

## Test

```bash
node tests/dev76-glow-journal.test.cjs
```

No HAOS installation or version bump in this initial backend-only commit.
