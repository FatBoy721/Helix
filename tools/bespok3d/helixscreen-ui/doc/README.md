# HelixScreen Touchscreen for Bespok3d

This experimental Snapmaker U1 plugin adds a reversible choice between the factory touchscreen and
[HelixScreen](https://github.com/prestonbrown/helixscreen). It does not replace the screen merely by
being installed: `snapmaker` is the default, and the factory `/usr/bin/gui` file is never deleted or
overwritten.

When `helixscreen` is selected, the plugin read-only bind-mounts its HelixScreen ELF over
`/usr/bin/gui` and asks the U1 display supervisor (`lmd`) to restart. This matches the supervision
model the U1 expects: `lmd` continues to own the GUI process and its recovery behavior. Switching
back or uninstalling removes the bind mount before `lmd` restarts, revealing the untouched factory
binary immediately. Bespok3d blocks the display restart while a print is active.

The plugin reapplies the selected mode at boot. Writable HelixScreen settings and cache live under
`/userdata/bespok3d/var/lib/helixscreen-ui`; uninstalling preserves that directory. If the packaged
binary is missing or fails its ELF check, selection fails closed to the factory screen.

## Build and provenance

The package builds HelixScreen v0.99.112 from pinned upstream commit
`59e2b0b3ffde67666b89db80845057fa1b0b9a5b` using upstream's Snapmaker U1 static cross-build. The
build adds deterministic Bespok3d defaults for the data, config, cache, DRM, supervision, and remote
framebuffer environment variables. Explicit supervisor-provided values still win.

HelixScreen is Copyright (C) 2025-2026 356C LLC and contributors and is licensed under
GPL-3.0-or-later. The complete corresponding source is that pinned public commit plus the
reproducible modification in this plugin's Dockerfile. The selector and Bespok3d packaging are part
of Helix and use the repository's license.

## Validation boundary

The selector is unit-tested without mounting anything on the developer machine. A baked package
must additionally pass an aarch64 ELF check. Before promotion beyond `experiment`, test both
directions on a real idle U1: factory to HelixScreen, HelixScreen to factory, reboot persistence,
camera coexistence, remote-screen mirroring, and uninstall restoration.
