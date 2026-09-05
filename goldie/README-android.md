# Play Store screenshots

goldie 0.3.1 added native Android support, so this is a normal goldie project
now. The `pixel-10-pro` device key drives the emulator over adb, pins the
status bar, replays argent flows, and renders **1080×1920** tiles — already
Play-legal (16:9, inside the 2:1 cap) with the bundled Pixel 10 Pro bezel.

The hand-rolled pipeline this replaced (`prep-raw.sh`, `play-resize.sh`,
`write-manifest.py`, a fake `iphone-6.9` raw directory, manual `adb input tap`
navigation, and a padding step to reach a legal aspect ratio) is **deleted**.
Do not reintroduce any of it.

```
goldie/
├── goldie.config.ts        scenes, copy, theme
├── scripts/
│   ├── printer-proxy.py    LAN bridge + /webcam/webrtc shim  (still ours)
│   └── gen-gear.py         generates the sample model
└── out/                    generated, gitignored
.argent/flows/store-*.yaml  one flow per scene
```

## Prerequisites

**The AVD must use the Pixel 10 Pro (or 9 Pro) hardware profile** — goldie
matches on it and will not use any other emulator. `Helix-Pixel10Pro` is that
AVD. Creating it needs **cmdline-tools 21.0**; 20.0 has no `pixel_10_pro`
device definition.

```bash
sdkmanager --install "cmdline-tools;21.0"
avdmanager create avd -n Helix-Pixel10Pro \
  -k "system-images;android-35;google_apis;arm64-v8a" -d "pixel_10_pro"
```

## Capture prep (goldie does not do these)

```bash
# 1. the printer bridge — MUST be /usr/bin/python3, see the script's docstring
/usr/bin/python3 goldie/scripts/printer-proxy.py &

# 2. emulator + tunnels
emulator -avd Helix-Pixel10Pro &
adb root                        # required to bind :80 inside the emulator
adb reverse tcp:7125 tcp:7125   # Moonraker
adb reverse tcp:8081 tcp:8081   # printer web root
adb reverse tcp:80   tcp:8081   # what the app's relative camera path hits

# 3. the sample model the slicer scenes open
python3 goldie/scripts/gen-gear.py
adb push "Reduction Gear 22T.stl" /sdcard/Download/

# 4. reset the file picker so it always starts at Recent (see Gotchas)
adb shell pm clear com.google.android.documentsui
```

Then:

```bash
GOLDIE_CONFIG=$PWD/goldie/goldie.config.ts npx -y goldie@0 capture
GOLDIE_CONFIG=$PWD/goldie/goldie.config.ts npx -y goldie@0 frame
GOLDIE_CONFIG=$PWD/goldie/goldie.config.ts npx -y goldie@0 manifest
GOLDIE_CONFIG=$PWD/goldie/goldie.config.ts npx -y goldie@0 studio --no-open
```

Upload from `goldie/out/screenshots/pixel-10-pro/en-US/`. Play allows 8 phone
screenshots, which is exactly what the config produces.

Do **not** run `doctor` or `verify` — both assume an iOS build and Apple's
spec table.

## Gotchas, all of them learned the hard way

**Every run starts with the app wiped.** argent's `reinstall-app` does
`adb uninstall` then `adb install`, so there is no printer configured and the
first-run sheet is showing. `store-home.yaml` therefore does the setup, and
the other flows inherit it because `launch:` resumes rather than clears. This
is why **store-home must stay first in `scenes`**.

**`launch:` resumes, it does not reset.** A modal left open by a previous
flow is still open for the next one, and the tab bar is then unreachable.
Flows that open a modal should leave the app on a normal screen.

**Never type into a field without settling first.** Focus lands
asynchronously; a keyboard step fired too early goes to the *previously*
focused field. That concatenated two URLs into the LAN box, and Helix handed
`http://127.0.0.1:7125http://…` straight to okhttp, which threw
`IllegalArgumentException: Invalid URL port` and **hard-crashed the app**
mid-capture. (That crash is a real Helix bug — the URL is never validated
before opening the websocket.)

**Prefer placeholder text over coordinates for fields.** Focusing a field
raises the keyboard, which reflows the dialog, so any coordinate measured
beforehand points at the wrong row afterwards.

**But some things cannot be selected by text.** The connection-mode pills are
labelled `"󰖩, LAN only"` — leading icon glyph — so `text:` misses them, and
the helper sentence below also contains "LAN only", so a looser match is
ambiguous. The flow sidesteps this entirely by relying on the `'lan'` default.

**`describe` sees through overlays.** The document picker's roots drawer is an
overlay; uiautomator lists the file rows underneath it as visible and
tappable, so taps land on the drawer and silently do nothing. Gate on the
drawer's title (`Open from`) disappearing, not on the row appearing.

**The picker remembers its last folder.** Tapping "Downloads" when Downloads
is already current does not dismiss the drawer, which then eats the file tap.
So `store-gcode` (scene 2) navigates via the drawer, and `store-model`
(scene 6) does not — by then the picker is already parked in Downloads.
`pm clear com.google.android.documentsui` in prep makes the first use
deterministic.

**Do not add a trailing `await idle` to dashboard flows.** Live temperatures
and the polling camera mean the screen never holds still, so idle always times
out with a warning. Use a fixed wait.

**Live data rots selectors.** `store-printsheet` used to tap a print by
filename and broke within days when the library changed. It now taps the first
row under ALL FILES by position — the list is sorted by Recent, so row 1 is
always "the most recent print", which is what the scene actually means.

**The chamber light.** The camera scene is much better lit with it on:

```bash
curl -s "http://127.0.0.1:7125/printer/gcode/script?script=SET_LED%20LED=cavity_led%20WHITE=1%20SYNC=0"
```

## Known cosmetic issue

The status-bar clock (pinned to 9:41 by goldie's demo mode) is clipped to
".41" by the bezel's screen window — the raw capture is clean, so this is
goldie's Pixel frame geometry against a 1280×2856 source. Harmless, but if it
ever matters, `theme.screenOnly: true` drops the bezel entirely.
