/**
 * Play Store assets for Helix.
 *
 * goldie's capture stage is iOS-only (it drives an iOS simulator through
 * argent), so it is NOT used here. The raw screenshots in out/raw/iphone-6.9/
 * are captured from an Android emulator with `adb exec-out screencap` — see
 * goldie/README-android.md — and only goldie's framing stage runs:
 *
 *   GOLDIE_CONFIG=<repo>/goldie/goldie.config.ts npx -y goldie@0 frame --screen-only
 *   GOLDIE_CONFIG=... npx -y goldie@0 manifest
 *   GOLDIE_CONFIG=... npx -y goldie@0 studio --no-open
 *
 * Do NOT run `capture`, `preview`, `doctor` or `verify`: they assume an iOS
 * build and Apple's spec table. `appPath` below is a placeholder that only
 * those stages read.
 *
 * The bezel is off (`screenOnly`) because the only bundled frames are iPhone
 * 17 Pro and these are Pixel captures. Play Store accepts bare screenshots.
 */

const APP_ROOT = "/Users/crabman/Documents/Projects/Helix-play-store";

const config = {
  appRoot: APP_ROOT,
  appPath: "unused-on-android.app",
  bundleId: "org.crabcore.u1control",

  devices: ["iphone-6.9"],
  locales: ["en-US"],
  appearance: "dark",

  // Required by the config schema even though `theme.screenOnly` means no
  // bezel is drawn — the bundled frames are all iPhone, these are Pixel shots.
  frame: { variant: "17-pro-silver" },

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
    screenOnly: true,
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
      headline: { "en-US": "Your printer, live" },
      subhead: {
        "en-US": "Camera, temperatures and every toolhead the second you open the app.",
      },
    },
    {
      kind: "screenshot",
      id: "gcode",
      headline: { "en-US": "The slicer is on your phone" },
      subhead: {
        "en-US": "A real slicing engine runs on the device. No laptop, no cloud.",
      },
    },
    {
      kind: "screenshot",
      id: "files",
      headline: { "en-US": "Every print, one library" },
      subhead: {
        "en-US": "Real thumbnails, search and history for everything on the printer.",
      },
    },
    {
      kind: "screenshot",
      id: "printsheet",
      headline: { "en-US": "Reprint in one press" },
      subhead: {
        "en-US": "Time, filament and which lane feeds it — checked before it starts.",
      },
    },
    {
      kind: "screenshot",
      id: "history",
      headline: { "en-US": "Every gram, every hour" },
      subhead: {
        "en-US": "Filament use, job history and lifetime totals for the machine.",
      },
    },
    {
      kind: "screenshot",
      id: "model",
      headline: { "en-US": "Set it up on the bed" },
      subhead: {
        "en-US": "Move, scale, rotate and orient before a single layer is sliced.",
      },
    },
    {
      kind: "screenshot",
      id: "mesh",
      headline: { "en-US": "See the bed, not the guesswork" },
      subhead: {
        "en-US": "Your live bed mesh in 3D, with the numbers that actually matter.",
      },
    },
    {
      kind: "screenshot",
      id: "filament",
      headline: { "en-US": "Tell it what's loaded" },
      subhead: {
        "en-US": "Colour, material and brand per toolhead, so previews match reality.",
      },
    },
  ],
};

export default config;
