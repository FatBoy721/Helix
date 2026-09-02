#!/bin/sh
set -eu

PLUGIN_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SWITCH=$PLUGIN_DIR/files/bin/helixscreen-ui-switch
MANIFEST=$PLUGIN_DIR/manifest.json
TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/helixscreen-ui-test.XXXXXX")
trap 'rm -rf "$TEST_ROOT"' EXIT HUP INT TERM

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

assert_contains() {
  case "$1" in
    *"$2"*) ;;
    *) fail "expected [$1] to contain [$2]" ;;
  esac
}

assert_file_line() {
  actual=$(sed -n '1p' "$1" 2>/dev/null || true)
  [ "$actual" = "$2" ] || fail "expected $1 to contain [$2], got [$actual]"
}

python3 - "$MANIFEST" <<'PY'
import json, sys
manifest = json.load(open(sys.argv[1], encoding="utf-8"))
assert manifest["name"] == "helixscreen-ui"
assert manifest["publisher"] == "PLACEHOLDER"
assert manifest["channel"] == "experiment"
field = next(item for item in manifest["config"] if item["key"] == "SCREEN_UI")
assert field["default"] == "snapmaker"
assert field["options"] == ["snapmaker", "helixscreen"]
assert manifest["install"]["restart"] == ["lmd"]
assert manifest["stop"] == ["$BESPOK3D_PLUGINS/helixscreen-ui/files/bin/helixscreen-ui-switch restore-stock"]
bake = manifest["bake"][0]
assert bake["platform"] == "linux/amd64"
assert bake["members"] == [{"path": "helixscreen", "dest": "files/helixscreen", "mode": "0755"}]
PY

FAKE_BESPOK=$TEST_ROOT/bespok3d
FAKE_PLUGINS=$FAKE_BESPOK/usr/local/plugins
FAKE_PLUGIN=$FAKE_PLUGINS/helixscreen-ui
FAKE_GUI=$TEST_ROOT/gui
FAKE_STOCK=$TEST_ROOT/gui.stock
FAKE_MOUNTS=$TEST_ROOT/mounts
FAKE_BIN=$TEST_ROOT/bin
FAKE_LMD_LOG=$TEST_ROOT/lmd.log
mkdir -p "$FAKE_PLUGIN/files/bin" "$FAKE_PLUGIN/files/helixscreen/bin" "$FAKE_BIN"
cp "$SWITCH" "$FAKE_PLUGIN/files/bin/helixscreen-ui-switch"
printf '\177ELFfake-helixscreen\n' > "$FAKE_PLUGIN/files/helixscreen/bin/helix-screen"
chmod 755 "$FAKE_PLUGIN/files/helixscreen/bin/helix-screen"
printf 'stock-gui\n' > "$FAKE_STOCK"
cp "$FAKE_STOCK" "$FAKE_GUI"
: > "$FAKE_MOUNTS"

cat > "$FAKE_BIN/mount" <<'SH'
#!/bin/sh
set -eu
source_path=$4
target_path=$5
rm -f "$target_path"
ln "$source_path" "$target_path"
printf 'fakefs %s none ro,bind 0 0\n' "$target_path" >> "$HELIXSCREEN_MOUNTS_FILE"
SH
cat > "$FAKE_BIN/umount" <<'SH'
#!/bin/sh
set -eu
target_path=$1
tmp=$HELIXSCREEN_MOUNTS_FILE.tmp
awk -v target="$target_path" '$2 != target' "$HELIXSCREEN_MOUNTS_FILE" > "$tmp"
mv "$tmp" "$HELIXSCREEN_MOUNTS_FILE"
rm -f "$target_path"
cp "$HELIXSCREEN_TEST_STOCK" "$target_path"
SH
cat > "$FAKE_BIN/lmdctl" <<'SH'
#!/bin/sh
printf '%s\n' "$*" >> "$HELIXSCREEN_TEST_LMD_LOG"
SH
chmod 755 "$FAKE_BIN/mount" "$FAKE_BIN/umount" "$FAKE_BIN/lmdctl"

run_switch() {
  PATH="$FAKE_BIN:$PATH" \
  BESPOK3D="$FAKE_BESPOK" \
  BESPOK3D_PLUGINS="$FAKE_PLUGINS" \
  HELIXSCREEN_GUI_TARGET="$FAKE_GUI" \
  HELIXSCREEN_MOUNTS_FILE="$FAKE_MOUNTS" \
  HELIXSCREEN_MOUNT_BIN="$FAKE_BIN/mount" \
  HELIXSCREEN_UMOUNT_BIN="$FAKE_BIN/umount" \
  HELIXSCREEN_LMDCTL="$FAKE_BIN/lmdctl" \
  HELIXSCREEN_TEST_STOCK="$FAKE_STOCK" \
  HELIXSCREEN_TEST_LMD_LOG="$FAKE_LMD_LOG" \
    "$FAKE_PLUGIN/files/bin/helixscreen-ui-switch" "$@"
}

status=$(run_switch status)
assert_contains "$status" "selected=snapmaker active=snapmaker"

run_switch configure helixscreen >/dev/null
assert_file_line "$FAKE_BESPOK/var/lib/helixscreen-ui/screen-ui" helixscreen
[ "$FAKE_GUI" -ef "$FAKE_PLUGIN/files/helixscreen/bin/helix-screen" ] || fail "HelixScreen was not bound"
grep -q " $FAKE_GUI " "$FAKE_MOUNTS" || fail "fake mount was not recorded"

status=$(run_switch status)
assert_contains "$status" "selected=helixscreen active=helixscreen"

run_switch start >/dev/null
assert_file_line "$FAKE_LMD_LOG" restart

run_switch configure snapmaker >/dev/null
assert_file_line "$FAKE_BESPOK/var/lib/helixscreen-ui/screen-ui" snapmaker
cmp -s "$FAKE_GUI" "$FAKE_STOCK" || fail "factory GUI was not restored"
[ ! -s "$FAKE_MOUNTS" ] || fail "mount record remained after stock restore"

if run_switch configure invalid >/dev/null 2>&1; then
  fail "invalid mode was accepted"
fi
assert_file_line "$FAKE_BESPOK/var/lib/helixscreen-ui/screen-ui" snapmaker

printf 'not-elf\n' > "$FAKE_PLUGIN/files/helixscreen/bin/helix-screen"
chmod 755 "$FAKE_PLUGIN/files/helixscreen/bin/helix-screen"
if run_switch configure helixscreen >/dev/null 2>&1; then
  fail "non-ELF HelixScreen binary was accepted"
fi
cmp -s "$FAKE_GUI" "$FAKE_STOCK" || fail "invalid binary did not fail closed to stock"
assert_file_line "$FAKE_BESPOK/var/lib/helixscreen-ui/screen-ui" snapmaker

sh -n "$SWITCH"
printf 'HelixScreen plugin tests passed\n'
