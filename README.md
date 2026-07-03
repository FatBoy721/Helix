# Helix

A mobile control app for the **Snapmaker U1** running **PAXX firmware**, built with
React Native (Expo). Fluidd-style dark UI, talks to the printer through Moonraker
over LAN or Tailscale.

<p align="center"><img src="assets/icon.png" width="160" alt="Helix"></p>

## Install

**Android:** grab the APK from the [latest release](https://github.com/FatBoy721/Helix/releases/latest)
and sideload it.

**From source:**

```bash
git clone https://github.com/FatBoy721/Helix.git
cd Helix
npm install
npx expo start
```

Scan the QR code with Expo Go, or `npx expo run:android` for a native build.

## Features

- **Dashboard** — live progress/ETA/layer, bed + T0–T3 temps, quick actions,
  one-tap emergency stop (fires over WebSocket *and* REST to every configured
  URL), Home All / Dock Toolhead, fan + purifier + bed controls, camera with
  LED toggle, fullscreen landscape view, and print-timing stats overlay.
  Every section is toggleable in Settings.
- **Multi-printer** — save several printers, switch with a tap, live status
  strip when you have more than one.
- **Bed Mesh** — Fluidd-style interactive 3D surface (drag to orbit, pinch to
  zoom), Catmull-Rom smoothed, real bed coordinates, saved profile preview +
  load, no CDN required (works fully offline).
- **Macros** — grouped by category so 120 PAXX macros don't hit you as a wall.
  Debounced buttons, ACE macros ask before running.
- **Console** — live G-code stream + input.
- **Files** — G-code list with embedded slicer thumbnails, tap to print.
- **History** — Fluidd-style printer stats (total jobs, print time, filament)
  plus per-job list with status icons and thumbnails.
- **Timelapse** — browse, play, and download timelapse videos in-app.
- **multiACE** — lane status with RFID info, dryer controls, load/unload,
  cross-ACE switching. Shows an honest empty state when no ACE hardware is
  connected. Uses the real PAXX multiACE commands (`ACE_LOAD_HEAD`, `A_DRY`,
  `ACE_SWITCH`, …).
- **Remote screen** — view the printer's touchscreen (PAXX `remote_screen`
  feature, see below).
- **Notifications** — Off, Local only, and ntfy modes. ntfy defaults to
  `https://ntfy.sh`, supports a generated topic, and can still point at a
  self-hosted server.
- **Connectivity** — LAN + Tailscale URLs with fast automatic failover
  (6s connect timeout, alternates per attempt). Camera/screen/timelapse URLs
  are host-relative so they follow whichever connection is active.
- **Theming + i18n** — accent color picker, English/Español/Deutsch/Français/中文.

## Printer setup notes (PAXX)

- **Tailscale**: PAXX has Tailscale built in. Set `vpn: tailscale` in
  `extended/extended2.cfg` (or via `http://<printer>/firmware-config/`), SSH in,
  run `tailscale up`, then put `http://<tailscale-ip>:7125` in Helix settings.
- **Remote screen**: set `remote_screen: true` in `extended2.cfg` and reboot —
  a "gui" feed appears in the app automatically.
- **USB camera**: enable in `extended/moonraker/03_usb_camera.cfg` — extra
  cameras registered in Moonraker show up in the app with zero config.
- **Server-side ntfy notifications** (fire even with the app closed): drop a
  Moonraker `[notifier]` config in `extended/moonraker/`, e.g.:

  ```ini
  [notifier print_done]
  url: ntfys://ntfy.sh/your-topic-here
  events: complete
  title: Print complete
  body: {event_args[1].filename} finished
  ```

## Development

- `npm run typecheck` — TypeScript check
- `npx expo export --platform android` — verify the bundle compiles
- Architecture notes live in the source: `hooks/useMoonraker.tsx` is the
  WebSocket JSON-RPC client (auto-reconnect, URL failover, status merge),
  `hooks/useACE.ts` wraps the multiACE object, `services/` holds REST and
  notification helpers.

## Contributing

Issues and PRs welcome. Translation fixes especially — the ES/DE/FR/ZH strings
in `services/i18n.ts` are best-effort.

## License

[MIT](LICENSE)
