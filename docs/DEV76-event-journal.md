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
