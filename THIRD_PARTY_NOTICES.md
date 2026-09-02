# Third-Party Notices

Helix includes open-source components licensed separately from the Helix UI and
Moonraker integration. This file satisfies attribution requirements for those
components.

## Native on-device slicing

Helix's Android slicing stack is derived from
**[u1-slicer-for-android](https://github.com/taylormadearmy/u1-slicer-for-android)**
by Taylor Madearmy (AGPL-3.0-or-later). Helix is a separate app and codebase;
it is not a fork of that project.

Relevant paths in this repository:

- `android/app/src/main/java/com/u1/slicer/` — JNI bridge, G-code parser, 3D viewers
- `android/app/src/main/java/org/crabcore/u1control/slicing/` — Helix integration layer
- `android/app/src/main/jniLibs/arm64-v8a/libprusaslicer-jni.so` — prebuilt slicing engine
- `android/app/src/main/assets/` — Orca machine/process profiles, vendor build-plate
  models under `bed/`, and GL shaders

## Slicing engine lineage

The native engine is built on Snapmaker Orca / OrcaSlicer and PrusaSlicer:

| Project | License | URL |
|---------|---------|-----|
| Snapmaker Orca / OrcaSlicer | AGPL-3.0 | https://github.com/SoftFever/OrcaSlicer |
| PrusaSlicer | AGPL-3.0 | https://github.com/prusa3d/PrusaSlicer |

The prebuilt `libprusaslicer-jni.so` binary is subject to the same copyleft
terms as its upstream engine. Source for the Helix integration and the
corresponding Kotlin/Java components is provided in this repository.

## MakerWorld

MakerWorld is a third-party service operated by Bambu Lab. Helix opens MakerWorld
pages in a WebView for user-initiated downloads; Helix does not redistribute
MakerWorld content.

## Bespok3d bootstrap packages

The Android app contains the unmodified bootstrap packages distributed with the
official Bespok3d Desktop v0.7.3 release:

- `bespok3d-daemon` 0.12.24 — https://github.com/Bespok3d/daemon
- `bespok3d-jinni-snapmaker-u1` 0.1.10 — https://github.com/Bespok3d/adapters

Both projects are licensed AGPL-3.0-or-later. Their signed manifests,
documentation, dependency metadata, and upstream copyright notices remain
inside `android/app/src/main/assets/bespok3d/bootstrap-v0.7.3.zip`. Helix checks
the packages against Bespok3d's pinned OpenPGP publisher key and verifies every
manifest SHA-256 before an enrollment operation can read the payload.

Copyright (C) 2026 unlucio and the Bespok3d contributors. Bespok3d is a
project of the Bespok3d Organisation, which is not a legal entity; copyright
is held by its individual authors. Helix is not affiliated with or endorsed by
Bespok3d.

## HelixScreen

Helix bundles `helixscreen-ui-0.1.0.b3`, which contains a build of
[HelixScreen](https://github.com/prestonbrown/helixscreen) v0.99.112:

- Copyright (C) 2025-2026 356C LLC and contributors
- License: GPL-3.0-or-later
- Exact upstream source: https://github.com/prestonbrown/helixscreen/tree/59e2b0b3ffde67666b89db80845057fa1b0b9a5b
- Helix build and packaging instructions: `tools/bespok3d/helixscreen-ui/`

Helix's package adds deployment metadata, a launcher, and the Docker build used
to compile the pinned upstream source for the Snapmaker U1. Those modifications
are available in this repository. Helix is not affiliated with or endorsed by
356C LLC or the HelixScreen contributors.

The full HelixScreen GPL text is in
`licenses/HelixScreen-GPL-3.0.txt`. Release builds package this notice, that
license, Helix's AGPL license, and `ATTRIBUTION.md` under the APK's `legal/`
assets directory.

## Your obligations when distributing Helix

If you distribute a build that includes the native slicer (release APK, CI
artifact, etc.):

1. Keep this file and `LICENSE` with the distribution.
2. Provide corresponding source for AGPL-covered components (this repo satisfies
   that for the integration layer; the engine binary's upstream is OrcaSlicer /
   PrusaSlicer).
3. Preserve copyright and license notices in source files you received under
   AGPL.

For Helix's full AGPL license text, see [LICENSE](LICENSE). For HelixScreen's
full GPL license text, see
[licenses/HelixScreen-GPL-3.0.txt](licenses/HelixScreen-GPL-3.0.txt).
