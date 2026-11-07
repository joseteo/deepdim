#!/usr/bin/env bash
# Regenerate the README images in .github/ from a throwaway nested GNOME
# Shell with synthetic content only (no real desktop, files or networks).
# Needs an X11 host session, ImageMagick, ffmpeg, gnome-text-editor and
# gnome-calculator. Usage: tools/screenshots.sh
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
T="${TMPDIR:-/tmp}/deepdim-shots"
OUT="$ROOT/.github"
FRAMES="$T/frames"
mkdir -p "$OUT"
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

js()   { "$ROOT/tests/shell-eval.sh" "$T/env" "$PRELUDE $1"; }
shot() { sleep "${2:-0.8}"; "$ROOT/tests/capture.sh" "$1"; }
PRELUDE='const ext = Main.extensionManager.lookup("deepdim@joseteo.github.com");
const dd = ext?.stateObj; const s = dd?.getSettings(); const qs = Main.panel.statusArea.quickSettings;
const win = c => global.get_window_actors().map(a => a.meta_window).find(w => w.get_wm_class()?.includes(c));'

start_shell() {  # $1 = monitors, $2 = mode spec
    "$ROOT/tests/nested-stop.sh"; sleep 1
    MODE_SPECS="$2" DEEPDIM_SETTINGS=$'enabled=false\nlevel=1.0' \
        "$ROOT/tests/nested-env.sh" "$T/env" "$1" &
    for _ in $(seq 80); do
        sleep 0.5
        [[ -f "$T/env/bus" ]] && [[ "$(js 'String(ext?.state)' 2>/dev/null)" == 1 ]] && break
    done
    sleep 2
    # Hide indicators that would show the host's network and the test-only unsafe mode.
    js 'for (const k of ["_network", "_bluetooth", "_unsafeMode", "_location", "_remoteAccess"]) {
            const i = qs[k]; if (!i) continue; i.hide(); i.quickSettingsItems.forEach(q => q.hide()); }
        Main.overview.hide(); "x"' >/dev/null
}

open_apps() {  # $1 editor x, $2 calculator x, $3 editor w, $4 editor h, $5 editor y, $6 calculator y
    cp "$ROOT/tools/sample-notes.txt" "$T/night-notes.txt"
    js "imports.gi.GLib.spawn_command_line_async('env GSETTINGS_BACKEND=memory gnome-text-editor --standalone $T/night-notes.txt'); \
        imports.gi.GLib.spawn_command_line_async('env GSETTINGS_BACKEND=memory gnome-calculator'); 'x'" >/dev/null
    for _ in $(seq 60); do
        sleep 0.5
        [[ "$(js 'String(!!win("TextEditor") && !!win("Calculator"))')" == true ]] && break
    done
    sleep 2
    js "const e = win('TextEditor'); e.unmaximize(3); e.move_resize_frame(true, $1, ${5:-70}, ${3:-620}, ${4:-520});
        const c = win('Calculator'); c.move_frame(true, $2, ${6:-140}); e.activate(global.get_current_time()); 'x'" >/dev/null
    # Park the pointer where it hides behind nothing interesting.
    js "imports.gi.Clutter.get_default_backend().get_default_seat().warp_pointer(global.stage.width - 2, global.stage.height - 2); 'x'" >/dev/null
    sleep 1
}

rm -rf "$T"; mkdir -p "$FRAMES"

echo "== single screen"
start_shell 1 1280x720
open_apps 110 760
shot "$T/off.png"
js 's.set_double("level", 0.4); s.set_boolean("enabled", true); "x"' >/dev/null
shot "$T/on.png"

# Before / after split
convert "$T/off.png" -crop 640x720+0+0 +repage "$T/l.png"
convert "$T/on.png" -crop 640x720+640+0 +repage "$T/r.png"
convert "$T/l.png" "$T/r.png" +append \
    -fill '#ffffffcc' -draw 'rectangle 638,0 641,720' \
    -font Inter-SemiBold -pointsize 22 \
    -fill '#000000a0' -draw 'roundrectangle 90,650 302,694 12,12' \
    -fill '#000000a0' -draw 'roundrectangle 1048,650 1256,694 12,12' \
    -fill white -annotate +110+680 'Without Deep Dim' \
    -fill white -annotate +1068+680 'Deep Dim at 6 %' \
    "$OUT/before-after.png"

# Quick Settings with the slider
js 's.set_double("level", 0.7); qs.menu.open(false); "x"' >/dev/null
shot "$T/qs.png" 1.2
convert "$T/qs.png" -crop 412x272+864+0 +repage "$OUT/quick-settings.png"

# Slider menu
js 's.set_double("warmth", 0.35); s.set_double("contrast", 0.85); dd._indicator.slider.menu.open(false); "x"' >/dev/null
shot "$T/menu.png" 1.2
convert "$T/menu.png" -crop 412x700+864+0 +repage "$OUT/menu.png"
js 'dd._indicator.slider.menu.close(false); s.reset("warmth"); s.reset("contrast"); "x"' >/dev/null

# Demo animation: slide down and back up with Quick Settings open
i=0
for lv in 1.0 0.95 0.9 0.85 0.8 0.75 0.7 0.65 0.6 0.55 0.5 0.45 0.4 0.35 0.3 0.25 0.2 \
          0.2 0.2 0.25 0.35 0.45 0.55 0.65 0.75 0.85 0.95 1.0 1.0 1.0; do
    js "s.set_double('level', $lv); 'x'" >/dev/null
    shot "$(printf '%s/f%03d.png' "$FRAMES" "$i")" 0.25
    i=$((i + 1))
done
qs_close='qs.menu.close(false); "x"'
js "$qs_close" >/dev/null
ffmpeg -loglevel error -y -framerate 8 -i "$FRAMES/f%03d.png" \
    -vf 'scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4' \
    "$OUT/demo.gif"

echo "== two screens, one excluded"
start_shell 2 960x540
open_apps 110 1320 600 440 50 30
js 's.set_double("level", 0.4); s.set_strv("excluded-monitors", [dd._controller._monitors[1].connector]); s.set_boolean("enabled", true); "x"' >/dev/null
shot "$T/multi.png" 1.2
convert "$T/multi.png" -fill '#ffffffcc' -draw 'rectangle 959,0 960,540' \
    -font Inter-SemiBold -pointsize 18 \
    -fill '#000000a0' -draw 'roundrectangle 750,488 916,524 10,10' \
    -fill '#000000a0' -draw 'roundrectangle 1000,488 1144,524 10,10' \
    -fill white -annotate +766+512 'Dimmed screen' \
    -fill white -annotate +1014+512 'Left alone' \
    "$OUT/per-screen.png"

"$ROOT/tests/nested-stop.sh"
echo "Images written to $OUT"; ls -l "$OUT"
