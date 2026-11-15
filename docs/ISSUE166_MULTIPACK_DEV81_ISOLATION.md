# Issue #166 — Multi-Pack isolation checkpoint (15 Nov 2026)

**Branch:** `fix/dev81-1-issue166-broadcast-integrity`

**Base:** exact DEV81.0 audited tree `e82f2cc453819ea09e1820d5298ecfeadfe2156a`, from `82642f2f29534186dd073479e4fda47c7b5bca7f`; identical tree to merged HAOS Test branch `cb5686485ec917581c3d1f74d689a38a2fc7175d` when branch created.

**Release constraints:** Legacy 4.1.13 remains untouched. No changes to the running Multi-Pack or HAOS Production. No blanket cherry-pick. MQTT Discovery #191 remains out of scope. Existing 28 DEV81 tests are baseline; a failing RED regression proves issues, not a deployable release.

## Baseline hazards independently verified in the original Multi-Pack flow

- `Type trames + adresse modbus` holds DATA in `pendingData` until the next SETUP and copies that SETUP's BMS ID onto DATA.
- Broadcast Framer publishes a JK reply candidate with `slave: lastModbusSlave`. This is transport context, **not proof** of the reply's sender; decoded DATA must use validated ACK address or be quarantined.
- DATA/SETUP/ALARM MQTT publishers accept invalid IDs, or silently convert them to master; Multi-Pack messages may fall back to `pack_1`.
- Pack 2–5 watchdogs emit `action: 'disconnect'` and do not test broadcasting mode; main watchdog has the same action.

## Test-first gates

1. `tests/dev81-1-issue166-identity-integrity-negative.test.cjs`: **RED by design** on DEV81.0. Includes same address across independent packs, DATA→other-BMS SETUP interleaving, JK checksum failure, ACK CRC failure, wrong SETUP ID, ACK outside 0..15, no-ACK DATA, forged pack provenance, invalid MQTT identities including `BMS_-488`/`BMS_327680`/`BMS_NaN`, and per-pack TCP watchdog action/mode.
2. Confirm expected failures on Pop!_OS with Node. Then fix the specific functions in this branch, never the installed add-on.
3. Preserve verified 300-byte/308-byte hardware profiles; a 300-byte DATA without independently verifiable identity must not be attributed to a different BMS. Any observed legitimate variant outside tested profiles is a release **NO-GO** until explicitly qualified.
4. Verify all 28 existing DEV81 tests, then fault-injection and live tests on **HAOS Test only** after separate release gating.

The new test itself must never connect to or write a physical BMS.
