/**
 * Play Store assets for Helix.
 *
 * goldie 0.3.1 added native Android support, so this is now a normal goldie
 * project — no custom capture scripts. The `pixel-10-pro` device key drives an
 * Android emulator over adb, pins the status bar with SystemUI demo mode, and
 * renders 1080x1920 tiles, which is already Play-Store-legal (16:9, under the
 * 2:1 cap). The old hand-rolled pipeline (prep-raw.sh, play-resize.sh,
 * write-manifest.py + a fake iphone-6.9 raw dir) is gone; see
 * README-android.md for the history and the printer-tunnel setup that is
 * still ours to run.
 *
 *   GOLDIE_CONFIG=<repo>/goldie/goldie.config.ts npx -y goldie@0 capture
 *   GOLDIE_CONFIG=... npx -y goldie@0 frame
 *   GOLDIE_CONFIG=... npx -y goldie@0 manifest
 *   GOLDIE_CONFIG=... npx -y goldie@0 studio --no-open
 *
 * The emulator MUST use the Pixel 10 Pro (or 9 Pro) hardware profile — goldie
 * matches on it. `Helix-Pixel10Pro` is that AVD; it needs cmdline-tools 21.0,
 * since 20.0 has no pixel_10_pro device definition.
 *
 * iOS is not configured here: `devices` lists only the Android key, so the
 * iOS-only fields are omitted entirely.
 */

const APP_ROOT = "/Users/crabman/Documents/Projects/Helix-play-store";

const config = {
  appRoot: APP_ROOT,

  android: {
    appPath: "../android/app/build/outputs/apk/release/app-release.apk",
    applicationId: "org.crabcore.u1control",
  },

  // Still required by the config loader (framePath() runs on every load) even
  // though this is an Android-only project: `frame` is iPhone bezel art and
  // does not apply to android tiles, which use the bundled Pixel 10 Pro frame.
  frame: { variant: "17-pro-silver" },

  devices: ["pixel-10-pro"],
  locales: ["en-US"],
  appearance: "dark",

  theme: {
    // Helix is a dark app; a deep cool gradient lets the screens sit on the
    // tile without a bright halo around them.
    background: "linear-gradient(165deg, #0B1220 0%, #111C2E 55%, #16233A 100%)",
    headlineColor: "#F2F6FF",
    subheadColor: "#93A4BF",
    fontFamily: '"DM Sans", -apple-system, system-ui, sans-serif',
    copyHeightRatio: 0.24,
    deviceWidthRatio: 0.86,
    // "uniform", not "editorial": editorial opens with a panorama that spans
    // two tiles, which reads as one wide image only in Apple's screenshot
    // strip. Play Store shows tiles individually, so every scene gets its own.
    template: "uniform",
    layout: "classic",
    // screenOnly is off now: goldie bundles a Pixel 10 Pro bezel and applies
    // it to android tiles automatically (the `frame` variant is iPhone art and
    // does not apply to them).
  },

  store: {
    name: "Helix",
    subtitle: { "en-US": "Control and slice on your phone" },
    developer: "crabcore",
    category: "Tools",
    rating: 4.8,
    ratingCount: "—",
    ageRating: "3+",
    price: "Free",
    description: {
      "en-US":
        "Helix drives your 3D printer from your phone. Live camera, temperatures, toolheads and the printer's own screen, mirrored the moment you open the app.\n\nIt also slices. A full slicing engine runs on the device, so a model goes from file to toolpaths to printing without a laptop or a cloud round-trip.\n\nWorks with Snapmaker U1, Klipper/Moonraker printers, Bambu Lab in LAN mode, and FlashForge AD5X.",
    },
  },

  scenes: [
    {
      kind: "screenshot",
      id: "home",
      flow: "store-home",
      headline: { "en-US": "Your printer, live" },
      subhead: {
        "en-US": "Camera, temperatures and every toolhead the second you open the app.",
      },
    },
    {
      kind: "screenshot",
      id: "gcode",
      flow: "store-gcode",
      headline: { "en-US": "The slicer is on your phone" },
      subhead: {
        "en-US": "A real slicing engine runs on the device. No laptop, no cloud.",
      },
    },
    {
      kind: "screenshot",
      id: "files",
      flow: "store-files",
      headline: { "en-US": "Every print, one library" },
      subhead: {
        "en-US": "Real thumbnails, search and history for everything on the printer.",
      },
    },
    {
      kind: "screenshot",
      id: "printsheet",
      flow: "store-printsheet",
      headline: { "en-US": "Reprint in one press" },
      subhead: {
        "en-US": "Time, filament and which lane feeds it — checked before it starts.",
      },
    },
    {
      kind: "screenshot",
      id: "history",
      flow: "store-history",
      headline: { "en-US": "Every gram, every hour" },
      subhead: {
        "en-US": "Filament use, job history and lifetime totals for the machine.",
      },
    },
    {
      kind: "screenshot",
      id: "model",
      flow: "store-model",
      headline: { "en-US": "Set it up on the bed" },
      subhead: {
        "en-US": "Move, scale, rotate and orient before a single layer is sliced.",
      },
    },
    {
      kind: "screenshot",
      id: "mesh",
      flow: "store-mesh",
      headline: { "en-US": "See the bed, not the guesswork" },
      subhead: {
        "en-US": "Your live bed mesh in 3D, with the numbers that actually matter.",
      },
    },
    {
      kind: "screenshot",
      id: "filament",
      flow: "store-filament",
      headline: { "en-US": "Tell it what's loaded" },
      subhead: {
        "en-US": "Colour, material and brand per toolhead, so previews match reality.",
      },
    },
  ],
};

export default config;
