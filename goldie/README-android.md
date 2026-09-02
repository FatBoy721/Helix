# Play Store screenshots (Android + goldie framing)

goldie is an iOS tool: its `capture` stage drives an iOS simulator through
argent, its only device spec is `iphone-6.9`, its only bezels are iPhone 17
Pro, and `verify` checks Apple's spec table. None of that applies to Android.

What *is* reusable is goldie's back half. `frame` only reads raw PNGs listed in
`out/raw/<device>/manifest.json` and composites them onto a captioned tile, so
Android captures can be fed straight into it.

**Only run these three stages.** `capture`, `preview`, `doctor` and `verify`
assume an iOS build and will fail or mislead.

## 1. Boot the emulator and install a release build

A debug build paints LogBox banners into the captures and needs Metro running,
so it makes unusable marketing assets. Use the release APK.

```bash
export PATH=/opt/homebrew/share/android-commandlinetools/platform-tools:$PATH
ANDROID_SDK_ROOT=/opt/homebrew/share/android-commandlinetools \
  /opt/homebrew/share/android-commandlinetools/emulator/emulator \
  -avd FoldFast-Pixel-8 -no-snapshot-load -no-boot-anim &
adb wait-for-device
adb install -r -d android/app/build/outputs/apk/release/app-release.apk
```

## 2. Give the emulator a route to the printer

An empty, offline app is not a screenshot worth shipping — the dashboard shows
a white error card and zeroed temperatures. But the emulator has **no route to
the LAN** (`nc: connect: No route to host`), so it cannot reach the printer
directly.

Bridge it with a host-side TCP proxy plus `adb reverse`:

- `scripts/printer-proxy.py` listens on `127.0.0.1:7125` → printer `:7125`
  (Moonraker) and `127.0.0.1:8081` → printer `:80` (web UI, camera, screen).
- **Run it with `/usr/bin/python3`.** macOS Local Network Privacy blocks
  Homebrew `node` from the LAN (`EHOSTUNREACH`) while Apple-signed binaries are
  allowed. This is not the Claude sandbox; disabling it does not help.

```bash
/usr/bin/python3 goldie/scripts/printer-proxy.py &     # edit TARGET first
adb root                       # needed to bind :80 inside the emulator
adb reverse tcp:7125 tcp:7125
adb reverse tcp:8081 tcp:8081
adb reverse tcp:80   tcp:8081  # the camera and mirrored screen live on :80
```

Then point the app at the tunnel: printer URL `http://127.0.0.1:7125`,
connection mode **LAN only**.

### The camera needs to be a snapshot, not WebRTC

The printer advertises `/webcam/webrtc`, and WebRTC needs UDP that an
`adb reverse` tunnel cannot carry — the card renders a dead player with
"Connection lost". `CameraFeed` treats any URL matching `/snapshot/i` as a
polled still image over plain HTTP, which the tunnel *does* carry.

The printer editor did not persist this field reliably, so write it directly
(requires `adb root`):

```bash
DB=/data/data/org.crabcore.u1control/databases/RKStorage
adb shell "sqlite3 $DB \"select value from catalystLocalStorage\"" > settings.json
# set .cameraUrl and .printers[active].cameraUrl to
#   http://127.0.0.1:8081/webcam/snapshot.jpg
adb push settings.new.json /data/local/tmp/settings.new.json
adb shell am force-stop org.crabcore.u1control
adb shell "sqlite3 $DB \"update catalystLocalStorage \
  set value = CAST(readfile('/data/local/tmp/settings.new.json') AS TEXT) \
  where key='u1control.settings.v1'\""
```

`CAST(... AS TEXT)` matters: a bare `readfile()` stores a BLOB and the app
falls back to first-run setup with every printer gone.

## 3. Clean the status bar

```bash
adb shell settings put global sysui_demo_allowed 1
for c in "command enter" "command clock -e hhmm 0930" \
         "command battery -e level 100 -e plugged false" \
         "command network -e wifi show -e level 4" \
         "command network -e mobile hide" \
         "command notifications -e visible false"; do
  adb shell am broadcast -a com.android.systemui.demo -e $c
done
```

## 4. Capture the scenes

```bash
adb exec-out screencap -p > goldie/captures/<scene-id>.png
```

One file per scene id in `goldie.config.ts`. Keep the untouched captures in
`goldie/captures/`; `scripts/prep-raw.sh` crops each one to 1080×2265 (dropping
the light 3-button nav bar, which clashes badly with Helix's dark UI) and
stages it in `out/raw/iphone-6.9/`. That directory is named `iphone-6.9`
because it is goldie's only device key — it does not mean the captures came
from an iPhone.

The Slice tab needs a model loaded or it screenshots as "NO MODEL". Generate
one with `scripts/gen-gear.py`, push it to `/sdcard/Download/`, and open it
through the app's own picker. Model coordinates map to bed coordinates, so
centre the mesh on the bed (the U1 plate is 220 mm) or it lands in a corner.

## 5. Prep, frame, resize

`frame` refuses to run without `out/raw/<device>/manifest.json`, which normally
comes from `capture`. `prep-raw.sh` crops the captures and writes that manifest
(it only needs sceneId/file per scene).

```bash
goldie/scripts/prep-raw.sh                                             # crop + manifest
GOLDIE_CONFIG=$PWD/goldie/goldie.config.ts npx -y goldie@0 frame --screen-only
GOLDIE_CONFIG=$PWD/goldie/goldie.config.ts npx -y goldie@0 manifest    # for the studio
goldie/scripts/play-resize.sh                                          # -> Play sizes
GOLDIE_CONFIG=$PWD/goldie/goldie.config.ts npx -y goldie@0 studio --no-open
```

`frame` needs `ffmpeg` on the PATH for its final flatten (`brew install
ffmpeg`). `--screen-only` suppresses the iPhone bezel; the config sets
`theme.screenOnly` too, so the flag is belt-and-braces.

`goldie frame` renders at 1320×2868 — Apple's 6.9" size, a **2.17:1** ratio.
Google Play caps phone screenshots at 2:1, so those tiles would be rejected as
they come out of goldie. `play-resize.sh` pads each one to exactly 9:16
(1620×2880) using `fillborders=mode=smear`, which replicates the edge pixels
so the background gradient extends instead of leaving solid bars.

**Upload from `goldie/out/play/phone/`, not from `out/screenshots/`.** The
`6.9`/`en-US` path segments are goldie's iOS naming and mean nothing to Play.

### The studio silently overrides the config

Running `goldie studio` writes `goldie/goldie.design.json`, and that file
**wins over `goldie.config.ts`** on every later `frame`. It appeared here with
a grey gradient and `template: "magazine"` — whose `minimal` layout draws no
copy at all — so the tiles came out grey and captionless with the config
untouched and looking correct.

If a re-frame comes out not matching the config, delete `goldie.design.json`
and frame again. Keep it only if you deliberately restyled in the studio and
want that look; the honest fix is to copy the values you liked back into
`theme.*` in the config and delete the file.

Play Store allows a maximum of **8** phone screenshots, which is what the
config produces. `captures/timelapse.png` is a spare (the Timelapse tab, with
real clip thumbnails) if you want to swap one out.
