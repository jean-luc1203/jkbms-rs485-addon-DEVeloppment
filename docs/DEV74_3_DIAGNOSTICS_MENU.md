# DEV74.3 — Premium Diagnostics navigation and sidebar labels

## Intent

DEV74.2 remains the validated HAOS Test baseline. DEV74.3 is an **isolated draft** and must **not** be deployed before physical BMS alarm and write checks are completed.

### New user-facing HA sidebar titles

| Existing URL path | Sidebar title | Role |
|---|---|---|
| `/smart-jkbms-glow/monitor` | **JK-BMS MultiPack** | Energy/pack monitoring |
| `/smart-jkbms-scada/process` | **JK-BMS SCADA** | SCADA and active-polling operation |
| `/smart-jkbms-multipack/diagnostics` | **JK-BMS Diagnostics** | Diagnostic status + aggregation |

All **URL paths, JSON file names, icons, Premium gating, and Supervisor slug are unchanged**. Only Lovelace registration titles and the existing dashboard's top-level tabs change. The `dashboard_sync.js` upsert already requests `lovelace/dashboards/update`; verify the existing sidebar titles after installing DEV74.3 since some HA versions may reject that metadata update without failing the config save.

### Diagnostics main navigation

- **Diagnostics** is now the first (landing) tab.
- **Agrégation** is the second tab, unchanged.
- The obsolete **Packs** overview is no longer registered as a top-level view.
- Pack/BMS detailed historical views remain registered as `subview: true`, preserving their existing deep-link paths and diagnostic use. No Node-RED discovery or physical BMS controls were removed.
- The old `/smart-jkbms-multipack/overview` page will no longer exist. Users should open the dashboard root or `/diagnostics` instead.

### Correct thresholds and issue details

Step 13G's actual diagnostic thresholds are **0.050 V (= 50 mV) per pack's cell delta** and **50 °C maximum temperature**. These values were previously dropped by *both* compact Home Assistant diagnostic-state publishers:
1. Step 13H `sanitizeDiagnostic()`.
2. SCADA Central Audit `compactDiagnostic()`.

DEV74.3 forwards `thresholds` and a bounded subset (max. 12 rows) of `active_issues` through each publisher, while keeping Recorder attributes compact. The diagnostic Lovelace view displays a true threshold only if it is present and numeric; otherwise displays an em dash rather than a fabricated `0 mV`. Both values remain defined by Step 13G, not by Lovelace. **No alarm detection thresholds, alarm lifecycle rules, RS485, MQTT transport, or write-command logic changed.**

### Validation checklist — before merging

1. Local test: `node tests/dev74-3-diagnostics-menu.test.cjs` plus existing DEV73/DEV74/DEV74.2 regression tests; `bash -n rootfs/etc/s6-overlay/s6-rc.d/init-nodered/run`.
2. After DEV74.2 physical alarm/write trials, make another Proxmox VM104 snapshot. Upgrade the *same* `ebedc3b5_smartphoton_jkbms_multipack` add-on only after owner approval.
3. Confirm the three new sidebar labels and identical dashboard URLs, without a duplicate or loss of Premium.
4. Verify Diagnostics lands first, Agrégation remains second, and Pack/BMS subview links remain functional.
5. Confirm thresholds show 50 mV / 50 °C; test that missing thresholds display unavailable rather than zero.
6. During a **controlled** alarm test, confirm `active_issues` is populated on the HA diagnostic sensor, rather than showing "Aucun problème actif" when its `issue_count` is nonzero.
7. Recheck SCADA v0.39, Glow, 4/4 packs, BMS 0/2 and 11 total BMS. Leave HAOS Production `.217` untouched.

### Rollback

No DEV74.2 runtime or packaged dashboard file is modified until a later explicit upgrade. The existing VM104 snapshot `before-DEV74-2` is available; prefer a separate pre-DEV74.3 snapshot immediately before any upgrade.
