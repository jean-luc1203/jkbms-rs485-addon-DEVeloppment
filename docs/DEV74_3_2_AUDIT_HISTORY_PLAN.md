# DEV74.3.2 — SCADA central history and UI consistency

Status: implementation in progress; NOT qualified for HAOS deployment.

## Verified problem
- HAOS compact Premium diagnostic state exposes `alarm_lifecycle.history_count` but deliberately omits `history`.
- SCADA `centralAlarmLifecycle()` reads that compact state, then `centralHistoryRows()` expects the absent `history` array. It displays 0 / 60 despite 60 central archived events.
- Node-RED publishes full retained snapshot at `jkbms/scada/audit/snapshot`. The 2026-11-02 retained snapshot has the complete Pack 2 Berlin TEMPERATURE_HIGH sequence, with first_seen, ack_at and cleared_at.
- Keep HA attributes compact: avoid Recorder and attribute-size regressions.

## Implementation constraints
1. Provide history to the SCADA frontend through a **verified, authenticated** read path. Do not put MQTT credentials, Supervisor tokens or secret URLs into static /local HTML; do not expose unauthenticated Node-RED endpoints.
2. Confirm client-side access and reload/reconnect behavior, including logged-in HA iframe and multiple SCADA browsers, before choosing the transport. Do not assume a generic HA WebSocket MQTT subscribe command exists.
3. Preserve the current Node-RED full retained topic and existing compact Home Assistant entities.
4. Distinguish BMS hardware alarms and Premium diagnostic warnings in Glow.
5. Make the SCADA responsive regression insensitive to subsequent DEV74 patch version bumps.
6. Re-run the six JS suites and test history: initial load, resolved records, ACK + clear, no data, disconnection and recovery.

## Safety
Only HAOS Test .184 after tests and maintainer approval. Do not alter HAOS Production .217, Legacy, or DEV74.3.1.
