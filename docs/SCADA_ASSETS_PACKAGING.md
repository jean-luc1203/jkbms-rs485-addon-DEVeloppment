# SmartPhoton Multi-Pack — packaging of SCADA web assets

## DEV72.1 issue found on 2026-10-18

Home Assistant successfully creates the `smart-jkbms-scada` Lovelace dashboard, but a fresh HAOS installation has no `/config/www/smartphoton_jkbms_multipack/scada/index.html`. Its iframe therefore displays a 404. A working reference HAOS had these files added manually.

## Packaged source files

The add-on Docker image must contain the three files below, copied **without modification** from the known-good reference archive `smartphoton-scada-assets.tar.gz`:

| Source under repository root | SHA-256 |
|---|---|
| `rootfs/etc/smartphoton_jkbms_multipack/www/scada/index.html` | `61779a237081b4d8bd39ba7ae0377060a00fb31fd1a76553fdfe21e9a81d5c51` |
| `rootfs/etc/smartphoton_jkbms_multipack/www/assets/bms-default.webp` | `d3a6f210d94b309e2d5209c201d4ebb6e4dd6567865046cace61a164ca0a5710` |
| `rootfs/etc/smartphoton_jkbms_multipack/www/assets/pack-default.webp` | `0590ebb9b0883a6ac4f3bf2496f212600871bd81739a1c17b25e7532d79719f9` |

The rootfs paths become `/etc/smartphoton_jkbms_multipack/www/...` in the image, since Dockerfile uses `COPY rootfs /`.

## Automatic deployment

`rootfs/etc/s6-overlay/s6-rc.d/init-nodered/run` installs these versioned files into the shared Home Assistant directory:

```
/config/www/smartphoton_jkbms_multipack/scada/index.html
/config/www/smartphoton_jkbms_multipack/assets/bms-default.webp
/config/www/smartphoton_jkbms_multipack/assets/pack-default.webp
```

The copy is idempotent, compares file contents and replaces only the three known assets. It does **not** delete unknown files, touch Node-RED flows, alter Premium licence files or change transport configuration. If the assets have not been included in the image, the add-on logs a warning instead of aborting battery monitoring.

## Verification on fresh HAOS

1. Ensure all three source files are committed on the candidate branch before building/testing it.
2. Build/install the candidate on an HAOS test VM, retain the production installation as rollback.
3. Inspect startup log for `SmartPhoton SCADA web assets available under /local/smartphoton_jkbms_multipack/`.
4. On HAOS, verify `ls -l /config/www/smartphoton_jkbms_multipack/{scada,assets}/`.
5. Open `http://<HAOS-TEST>:8123/local/smartphoton_jkbms_multipack/scada/index.html` and `http://<HAOS-TEST>:8123/smart-jkbms-scada/process`. The second route embeds the first.
6. Reload Home Assistant frontend / clear browser cache if it still shows the old 404. If `www` was created for the first time, restart Home Assistant Core if necessary.
7. Confirm that Lovelace Multi-Pack, MQTT, Active Polling 0+2 and the production Broadcasting instance remain unchanged.

> Only merge/release after all three source assets and this deployment hook are present together. Do not merge the hook by itself, since it only emits a warning without the packaged HTML/images.
