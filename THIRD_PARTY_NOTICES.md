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
- `android/app/src/main/assets/` — Orca U1 machine/process profiles and GL shaders

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

## Your obligations when distributing Helix

If you distribute a build that includes the native slicer (release APK, CI
artifact, etc.):

1. Keep this file and `LICENSE` with the distribution.
2. Provide corresponding source for AGPL-covered components (this repo satisfies
   that for the integration layer; the engine binary's upstream is OrcaSlicer /
   PrusaSlicer).
3. Preserve copyright and license notices in source files you received under
   AGPL.

For the full license text, see [LICENSE](LICENSE).
