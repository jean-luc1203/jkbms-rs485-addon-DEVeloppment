# DEV74.2 — SCADA responsive / BMS operator readability

**Status:** isolated candidate, not deployed or visually validated on HAOS. Based on `feature/dev74-glow-scada-dual-dashboard` (DEV74.1). No transport, MQTT, Active Polling, Premium licensing, alarms or write-command logic was intentionally changed.

## Problem observed on real HAOS Test

SCADA looked correct on a large desktop but some labels in BMS operator sheets were too small; on narrower desktops and in Home Assistant iframes, columns and cards were misplaced or clipped. Earlier SCADA breakpoints hid both the source and health panels entirely under 1200px.

## Presentation-only changes

- Larger BMS operator labels (14–15px), readings (roughly 19–25px), state tiles and action buttons, with wrapping instead of clipped values.
- Wider BMS detail sheet when room permits; switch from side-by-side hero/metrics to stacked sections on narrower viewports.
- Replace absolute/fixed synoptic positioning with a flowing grid on smaller screens. **Do not hide** the source/process and diagnostic panels: move them above/below the pack grid.
- Reflow pack cards, rail, trends, navigation, technical-parameter grids, confirmation dialogs and alarm/audit rows at viewport widths 1500, 1050, 800, 600 and 390px.
- Keep scrolling within SCADA's main view or modal, and use the Home Assistant iframe viewport, including dynamic viewport height.
- Only two class names were added to the BMS operator HTML template; all data calculations and commands remain untouched.
- SCADA UI label v0.39, candidate add-on version `1.0.0-dev74.2`.

## Local regression

```sh
node tests/dev73-bms0-setup-discovery.test.cjs
node tests/dev74-glow-dashboard.test.cjs
node tests/dev74-dashboard-sync-paths.test.cjs
node tests/dev74-scada-responsive.test.cjs
bash -n rootfs/etc/s6-overlay/s6-rc.d/init-nodered/run
git status --short
```

The responsive test verifies SCADA JavaScript parses, scoped BMS markup, key breakpoints, visible source/health panels, and balanced CSS. **Static tests do not prove browser layout.**

## Manual browser validation on HAOS Test .184

Test via `/smart-jkbms-scada/process` (Premium/HA embedded view) with real Pack 1 (BMS 0 and 2) and simulated packs 2–4. For each of 1920, 1600, 1366, 1280, 1024, 768, 600 and 390 CSS pixels (or browser responsive emulation), verify:

1. The synoptic shows every pack; source power and health are visible and correctly located.
2. Process, Packs, BMS, Alarmes, Audit, Trends, Service all scroll normally, with no lost information or horizontal clipping.
3. Open Pack 1, then BMS 0 and BMS 2. Check readable labels/values, full set of 12 metric/state tiles, clear action buttons, and accessible close/back navigation.
4. Open cell diagnostics, Conduite and technical parameters **read-only**. Check that inputs, labels and confirmations fit; do not execute BMS write commands during this visual test.
5. Check Home Assistant sidebar expanded and collapsed; browser zoom 80%, 100%, 125%; laptop with reduced window height; modal scroll and sticky header.
6. Verify Glow remains unchanged and that SCADA still reports HA LIVE, 4 packs, 11 BMS, correct BMS 0/2, and actual measurements.

**Safety:** This branch is a distinct HAOS Supervisor candidate with the same internal slug and shared `/config/smartphoton_jkbms_multipack/` and port 1891. Never run DEV74.1 and DEV74.2 simultaneously. Back up HAOS Test and stop the existing candidate (disable autostart/watchdog) before starting DEV74.2. Keep HAOS Production .217 untouched. Use the existing Proxmox rollback snapshot or a newer one.

## Acceptance criteria

- No critical content hidden at target widths; vertical scrolling is allowed.
- BMS operator labels and values are readable at 100% browser zoom.
- All real BMS data remain unchanged, including addresses 0 and 2.
- No regressions to Premium dashboard registration, SCADA/Glow assets, MQTT, alarm presentation or command safety.
- Owner approves actual screenshots before merging this candidate.
