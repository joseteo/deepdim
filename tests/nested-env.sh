#!/usr/bin/env bash
# Start a throwaway nested GNOME Shell with Deep Dim + the test helper.
# Its settings live in a keyfile under $1, so the real session is untouched.
# Usage: tests/nested-env.sh <state-dir> [monitors]   (prints the dbus address)
set -euo pipefail
T="$1"; MONITORS="${2:-2}"
SRC="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
rm -rf "$T"; mkdir -p "$T"/{data/gnome-shell/extensions,config/glib-2.0/settings,cache,state}
EXT="$T/data/gnome-shell/extensions/deepdim@joseteo.github.com"

XDG_DATA_HOME="$T/data" "$SRC/install.sh" --no-enable >/dev/null
cp -r "$SRC/tests/helper" "$T/data/gnome-shell/extensions/deepdim-testhelper@joseteo.github.com"
cat > "$T/config/glib-2.0/settings/keyfile" <<KF
[org/gnome/shell]
enabled-extensions=['deepdim@joseteo.github.com', 'deepdim-testhelper@joseteo.github.com']
welcome-dialog-last-shown-version='999'

[org/gnome/shell/extensions/deepdim]
${DEEPDIM_SETTINGS:-}
KF
export XDG_DATA_HOME="$T/data" XDG_CONFIG_HOME="$T/config" XDG_CACHE_HOME="$T/cache" XDG_STATE_HOME="$T/state"
export GSETTINGS_BACKEND=keyfile
export MUTTER_DEBUG_DUMMY_MODE_SPECS="${MODE_SPECS:-960x540}"
export MUTTER_DEBUG_NUM_DUMMY_MONITORS="$MONITORS"
exec dbus-run-session -- bash -c 'echo "$DBUS_SESSION_BUS_ADDRESS" > "'"$T"'/bus"; exec gnome-shell --nested --wayland' > "$T/shell.log" 2>&1
