# Helix — Snapmaker U1 (PAXX) mobile control app

React Native (Expo 54 / RN 0.81) app controlling a Snapmaker U1 running PAXX firmware
over Moonraker (LAN + Tailscale). Fluidd-style dark UI. Target: Android sideload APK.

## Commands
- `npm run typecheck` → `tsc --noEmit`
- `npx eslint . --quiet`
- `npm run test:regressions` → `node scripts/check-regressions.js` (pure-logic regression suite, ~30 tests; does NOT cover UI or filament/RFID code)
- `npx expo start` / `npx expo run:android`
- APK build output: `android/app/build/outputs/apk/release/app-release.apk`

A task is NOT done until `npm run typecheck` and `npx eslint . --quiet` both pass with zero errors.

## Architecture
- `hooks/useMoonraker.tsx` — WebSocket JSON-RPC client (auto-reconnect, LAN/Tailscale URL failover, status merge). The core of the app.
- `hooks/useACE.ts` — wraps the multiACE object.
- `services/` — REST + notification helpers. `services/moonraker.ts` has the REST `api` object and URL normalization.
- `app/(tabs)/` — expo-router tab screens (index/dashboard, ace, console, files, mesh, settings, slicer, spoolman, tools).
- `components/` — feature components; `components/settings/` for settings cards.

## Filament / RFID (important)
Manual filament writes go through `api.setFilamentSlot` in `services/moonraker.ts`. The correct
sequence is a TWO-STEP write (a single-step write leaves stale RFID "official" data that overrides
the manual values):
1. `POST /printer/filament_detect/set` with **empty** `info: {}` → clears the stale RFID cache for that channel.
2. `POST /printer/gcode/script` running `SET_PRINT_FILAMENT_CONFIG CONFIG_EXTRUDER=<n> VENDOR="..." FILAMENT_TYPE=... FILAMENT_SUBTYPE="..." COLORS=... ALPHA=... FORCE=1` (built by `buildManualFilamentSlotCommand`).

Color/material/brand edits pass a `changedIndex` so only ONE channel is re-broadcast, not all 4.

### Firmware filament model (verified from U1_extended_1.5.2-paxx12-test-pr-567.bin)
The firmware has TWO separate filament data systems — do not conflate them:
1. **`filament_parameters.py`** (toolhead behavior: load/unload/clean/flow temps) — only **3 vendors** are
   tuned: `vendor_generic`, `vendor_Snapmaker`, `vendor_Polymaker`. Any other vendor string falls through
   to `vendor_generic`. Sub-types that change temps: Silk (+10°C flow), Matte (−5°C), SnapSpeed, Wood,
   HF, 95A HF.
2. **`id_material.json`** (openrfid tigertag DB) — a 96-material **chemistry** catalog with temp ranges
   (nozzle min/max, bed min/max, dry temp/time). NOT vendor-keyed. `bambuID` / `crealityID` fields are
   RFID recognition keys only, **not** separate profiles.

**KEY:** typing "Bambu" (or eSun, Anycubic, etc.) as `VENDOR` does nothing special — the firmware only
special-cases Generic/Snapmaker/Polymaker. The values that actually move temps are `MAIN_TYPE`
(PLA/PETG/PA-CF/PEEK…) and `SUB_TYPE` (Silk/Matte/HF/CF…). Vendors other than those 3 are cosmetic.

Vendor identity at runtime comes from the RFID tag (readers: `openspool` = Bambu-style OpenSpool NDEF,
`spoolease`, `tigertag`). OpenSpool/SpoolEase tags carry their own nozzle temps + brand in the tag payload.

### Firmware extraction recipe
`U1_...pr-567_upgrade.bin` is a compressed upgrade package. Carve the SquashFS (gzip, 220MB) at offset
`0x159AAE6`:
```
tail -c +22653671 <bin> | head -c 220182862 > rootfs.squashfs
7z x rootfs.squashfs            # or: 7z e for specific paths
```
Key files inside: `home/lava/klipper/klippy/extras/filament_parameters.py`,
`usr/local/share/openrfid/tag/tigertag/database/id_material.json`,
`usr/local/share/openrfid/extended/openrfid_u1_vendor.cfg`.

## Known gaps / TODO
- ~~`buildManualFilamentSlotCommand` has no unit tests~~ **Resolved 2026-07-23**: 13 tests in `scripts/check-regressions.js` cover channel bounds, text escaping, MAIN_TYPE regex, color/alpha clamping + fallbacks, and trim.
- ~~`components/FilamentSlotsEditor.tsx` `MATERIAL_PRESETS` is a 9-item list that doesn't match the firmware's full material/sub-type catalog~~ **Resolved 2026-07-23**: filament selection is now a MAIN_TYPE (42 base polymers from `id_material.json`) + SUB_TYPE (16 fillers/finishes) split, sourced from `services/filamentMaterials.ts`. SUPPORT removed. `filamentSlotSubtypes` persisted via `settingsMigration.ts` (STORAGE_VERSION 11); `index.tsx`/`slicer.tsx` write SUB_TYPE from settings. 4 catalog-conformance tests guard it.
- Catalog of all 96 firmware materials: `/tmp/u1_material_catalog.{txt,json}` (also pushed to phone `/sdcard/Download/`).

## Session log
- 2026-07-23: Reviewed uncommitted RFID/filament fix on branch `play-store-prep` (clear-then-write + per-slot `changedIndex`). Verified tsc/eslint/regressions pass; flagged missing test coverage. Extracted + analyzed firmware filament model. Full notes in Cortex note #31 + memories `helix/*`.
