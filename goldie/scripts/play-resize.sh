#!/bin/bash
# goldie renders at 1320x2868 — Apple's 6.9" size, a 2.17:1 ratio. Google Play
# wants phone screenshots at 16:9 or 9:16 (and no taller than 2:1), so pad each
# tile to exactly 9:16 (1620x2880). `fillborders=mode=smear` replicates the
# edge pixels outward, so the background gradient extends seamlessly instead of
# leaving solid bars.
set -e
SRC="$(dirname "$0")/../out/screenshots/6.9/en-US"
DST="$(dirname "$0")/../out/play/phone"
rm -rf "$DST"          # else a shorter scene list leaves stale tiles behind
mkdir -p "$DST"
for f in "$SRC"/*.png; do
  n=$(basename "$f")
  ffmpeg -y -loglevel error -i "$f" \
    -vf "pad=1620:2880:150:6,fillborders=left=150:right=150:top=6:bottom=6:mode=smear" \
    -pix_fmt rgb24 "$DST/$n"
  echo "  play $n"
done
echo "-> $DST"
