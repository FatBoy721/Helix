# syntax=docker/dockerfile:1
# HelixScreen's Snapmaker U1 build is an aarch64 static binary produced by an
# amd64 cross-toolchain. b3-builder therefore runs this image as linux/amd64
# even when the build host is arm64.
FROM debian:trixie-slim AS build

ARG HELIXSCREEN_COMMIT=59e2b0b3ffde67666b89db80845057fa1b0b9a5b
ARG HELIXSCREEN_TAG=v0.99.112

ENV DEBIAN_FRONTEND=noninteractive
ENV CROSS_COMPILE=aarch64-linux-gnu-
ENV CC=aarch64-linux-gnu-gcc
ENV CXX=aarch64-linux-gnu-g++
ENV AR=aarch64-linux-gnu-gcc-ar
ENV STRIP=aarch64-linux-gnu-strip
ENV RANLIB=aarch64-linux-gnu-gcc-ranlib
ENV LD=aarch64-linux-gnu-ld
ENV PKG_CONFIG_PATH=/usr/lib/aarch64-linux-gnu/pkgconfig
ENV PKG_CONFIG_SYSROOT_DIR=/

RUN echo 'Acquire::Retries "3";' > /etc/apt/apt.conf.d/80-retries && \
    apt-get update && apt-get install -y --no-install-recommends \
      autoconf automake bison build-essential ca-certificates ccache cmake \
      crossbuild-essential-arm64 file flex git libtool make pkg-config \
      python3 zip && \
    dpkg --add-architecture arm64 && apt-get update && \
    apt-get install -y --no-install-recommends \
      libc6-dev:arm64 libdrm-dev:arm64 libevdev-dev:arm64 \
      libinput-dev:arm64 libmtdev-dev:arm64 libssl-dev:arm64 \
      libstdc++-14-dev:arm64 libudev-dev:arm64 libzstd-dev:arm64 \
      zlib1g-dev:arm64 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git init . && \
    git remote add origin https://github.com/prestonbrown/helixscreen.git && \
    git fetch --depth 1 origin "refs/tags/${HELIXSCREEN_TAG}" && \
    git checkout --detach FETCH_HEAD && \
    test "$(git rev-parse HEAD)" = "$HELIXSCREEN_COMMIT" && \
    git submodule update --init --recursive --depth 1

# lmd binds and supervises this ELF directly as /usr/bin/gui, so there is no
# launcher process from which HelixScreen can inherit environment variables.
# Add only deterministic Bespok3d defaults; overwrite=0 preserves an explicit
# value supplied by a future supervisor.
RUN <<'SH'
python3 - <<'PY'
from pathlib import Path

path = Path("src/main.cpp")
source = path.read_text()
anchor = "int main(int argc, char** argv) {"
replacement = """int main(int argc, char** argv) {
    // Bespok3d Snapmaker U1 package defaults. Keep explicit supervisor values.
    ::setenv("HELIX_DATA_DIR", "/userdata/bespok3d/usr/local/plugins/helixscreen-ui/files/helixscreen", 0);
    ::setenv("HELIX_CONFIG_DIR", "/userdata/bespok3d/var/lib/helixscreen-ui/config", 0);
    ::setenv("HELIX_CACHE_DIR", "/userdata/bespok3d/var/lib/helixscreen-ui/cache", 0);
    ::setenv("HELIX_SUPERVISED", "1", 0);
    ::setenv("HELIX_DRM_DEVICE", "/dev/dri/card0", 0);
    ::setenv("HELIX_REMOTE_SCREEN_FB0", "/dev/fb0", 0);"""
assert source.count(anchor) == 1, "main.cpp entry anchor changed"
path.write_text(source.replace(anchor, replacement))
PY
SH

RUN make PLATFORM_TARGET=snapmaker-u1 SKIP_OPTIONAL_DEPS=1 -j2 && \
    make PLATFORM_TARGET=snapmaker-u1 release-snapmaker-u1 && \
    mkdir -p /out && \
    tar -xzf releases/helixscreen-snapmaker-u1-v0.99.112.tar.gz -C /out && \
    file /out/helixscreen/bin/helix-screen | grep -q 'ARM aarch64' && \
    test "$(od -An -N4 -tx1 /out/helixscreen/bin/helix-screen | tr -d '[:space:]')" = 7f454c46

FROM scratch
COPY --from=build /out /out
CMD ["true"]
