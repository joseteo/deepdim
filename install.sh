#!/usr/bin/env bash
# Install Deep Dim for the current user.
set -euo pipefail
SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
UUID="deepdim@joseteo.github.com"
DEST_DIR="${XDG_DATA_HOME:-${HOME}/.local/share}/gnome-shell/extensions/${UUID}"
if [[ -L "$DEST_DIR" ]]; then
    echo "Refusing to replace a symlink: $DEST_DIR" >&2
    exit 1
fi
if [[ "$SOURCE_DIR" == "$DEST_DIR" ]]; then
    echo 'Run install.sh from the source checkout.' >&2
    exit 1
fi
rm -rf "$DEST_DIR"
mkdir -p "$DEST_DIR/lib" "$DEST_DIR/schemas" "$DEST_DIR/prefs" "$DEST_DIR/icons"
install -m 644 "$SOURCE_DIR/metadata.json" "$SOURCE_DIR/extension.js" "$SOURCE_DIR/prefs.js" \
    "$SOURCE_DIR/stylesheet.css" "$SOURCE_DIR/LICENSE" "$DEST_DIR/"
install -m 644 "$SOURCE_DIR"/lib/*.js "$DEST_DIR/lib/"
install -m 644 "$SOURCE_DIR"/prefs/*.js "$DEST_DIR/prefs/"
install -m 644 "$SOURCE_DIR"/icons/*.svg "$DEST_DIR/icons/"
install -m 644 "$SOURCE_DIR"/schemas/*.xml "$DEST_DIR/schemas/"
glib-compile-schemas --strict "$DEST_DIR/schemas"

if [[ "${1:-}" != "--no-enable" ]]; then
    # GNOME 46 only discovers new extensions at startup. Mark it enabled so
    # it starts on the next Shell reload.
    gjs -c 'const Gio = imports.gi.Gio; const s = new Gio.Settings({schema_id: "org.gnome.shell"}); const id = "deepdim@joseteo.github.com"; const e = s.get_strv("enabled-extensions"); if (!e.includes(id)) s.set_strv("enabled-extensions", [...e, id]); const d = s.get_strv("disabled-extensions"); if (d.includes(id)) s.set_strv("disabled-extensions", d.filter(v => v !== id)); Gio.Settings.sync();'
fi
echo "Installed $UUID"
echo 'If the slider is not in Quick Settings yet: on X11 press Alt+F2, type r, Enter. On Wayland, log out and back in.'
