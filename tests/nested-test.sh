#!/usr/bin/env bash
# End-to-end test of Deep Dim in a throwaway nested GNOME Shell (two 960x540
# screens). Measures real composited pixels of the nested window from the
# host X server. Needs an X11 host session, ImageMagick and xwininfo.
#
# Usage: tests/nested-test.sh [state-dir]
set -uo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
T="${1:-${TMPDIR:-/tmp}/deepdim-nested-test}"
SHOTS="$T/shots"
PASS=0; FAIL=0

ok()   { PASS=$((PASS + 1)); echo "  ok   $*"; }
bad()  { FAIL=$((FAIL + 1)); echo "  FAIL $*"; }
js()   { "$HERE/shell-eval.sh" "$T" "$PRELUDE $1"; }
shot() { sleep "${2:-0.6}"; "$HERE/capture.sh" "$SHOTS/$1.png"; }
mean() { convert "$SHOTS/$1.png" ${2:+-crop "$2"} -format '%[fx:mean]' info:; }
# assert_near name got want tolerance
assert_near() {
    if python3 -c "import sys; g,w,t=map(float,sys.argv[1:]); sys.exit(0 if abs(g-w)<=t else 1)" "$2" "$3" "$4"
    then ok "$1 ($2 ~ $3)"; else bad "$1 (got $2, want $3 ± $4)"; fi
}
run() { local out; out=$(js "$1" 2>&1) || bad "js threw: ${out:0:300}"; }
assert_eq() { if [[ "$2" == "$3" ]]; then ok "$1 ($2)"; else bad "$1 (got '$2', want '$3')"; fi; }

PRELUDE='const ext = Main.extensionManager.lookup("deepdim@joseteo.github.com");
const dd = ext.stateObj; const s = dd?.getSettings(); const ui = Main.layoutManager.uiGroup;
const fx = () => ui.get_effect("deepdim-filter");'

"$HERE/nested-stop.sh"; sleep 1
DEEPDIM_SETTINGS=$'enabled=false\nlevel=0.3' "$HERE/nested-env.sh" "$T" 2 &
mkdir -p "$SHOTS"
for _ in $(seq 60); do
    sleep 0.5
    [[ -f "$T/bus" ]] && [[ "$(js 'ext?.state' 2>/dev/null)" == 1 ]] && break
done
sleep 2
mkdir -p "$SHOTS"
trap '"$HERE/nested-stop.sh"' EXIT

echo "1. lifecycle"
assert_eq "extension enabled" "$(js 'ext.state')" 1
assert_eq "no error" "$(js 'ext.error || "none"')" none
assert_eq "no effect while off" "$(js 'String(fx() ?? null)')" null
run 'Main.notificationDaemon && Main.messageTray._notificationQueue?.forEach?.(n => n.destroy()); Main.messageTray.close?.(); "x"'
run 'Main.overview.hide(); "x"'
# Test window. Its own in-memory settings: every process in the nested
# session shares one keyfile, and a stale writer would revert our keys.
run 'imports.gi.GLib.spawn_command_line_async("env GSETTINGS_BACKEND=memory gnome-calculator"); "x"'
for _ in $(seq 60); do sleep 0.5
    [[ "$(js 'String(global.get_window_actors().some(a => a.meta_window.get_wm_class()?.includes("Calc")))')" == true ]] && break
done
sleep 1
CALC='const w = global.get_window_actors().map(a => a.meta_window).find(w => w.get_wm_class()?.includes("Calc"));'
run "$CALC w.minimize(); \"x\""
shot off 1.5

echo "2. dimming math on real pixels"
run 's.set_double("floor", 0.01); s.set_double("level", 0.3); s.set_boolean("enabled", true); "x"'
assert_eq "effect attached" "$(js 'fx()?.constructor.name')" DeepDimEffect
shot dim
want=$(python3 -c 'print((0.01 ** 0.7) ** (1 / 2.2))')
got=$(python3 -c "print($(mean dim) / $(mean off))")
assert_near "mean ratio = encoded scale" "$got" "$want" 0.01

run 's.set_double("level", 0); "x"'; shot dark
got=$(python3 -c "print($(mean dark) / $(mean off))")
assert_near "darkest level = floor^(1/2.2)" "$got" "$(python3 -c 'print(0.01 ** (1/2.2))')" 0.01
run 's.set_double("level", 0.3); "x"'

echo "3. per-screen exclusion"
run 's.set_strv("excluded-monitors", [dd._controller._monitors[1].connector]); "x"'
shot skip
assert_near "right screen untouched" "$(mean skip 960x540+960+0)" "$(mean off 960x540+960+0)" 0.0005
got=$(python3 -c "print($(mean skip 960x540+0+0) / $(mean off 960x540+0+0))")
assert_near "left screen dimmed" "$got" "$want" 0.01
assert_near "column 959 dimmed" "$(mean skip 1x400+959+100)" \
    "$(python3 -c "print($(mean off 1x400+959+100) * $want)")" 0.01
assert_near "column 960 untouched" "$(mean skip 1x400+960+100)" "$(mean off 1x400+960+100)" 0.0005

echo "4. window straddling both screens (per-view offscreen render)"
run "$CALC w.unminimize(); \"x\""
sleep 1
run 'const w = global.get_window_actors().map(a => a.meta_window).find(w => w.get_wm_class()?.includes("Calc")); w.move_frame(true, 800, 250); w.activate(global.get_current_time()); "x"'
run 'fx().enabled = false; ui.queue_redraw(); "x"'; shot straddle-off 1.2
run 'fx().enabled = true; ui.queue_redraw(); "x"'; shot straddle-on 1.2
assert_near "window half on undimmed screen intact" \
    "$(mean straddle-on 190x280+965+255)" "$(mean straddle-off 190x280+965+255)" 0.002
got=$(python3 -c "print($(mean straddle-on 150x280+805+255) / $(mean straddle-off 150x280+805+255))")
assert_near "window half on dimmed screen dimmed" "$got" "$want" 0.02
run 's.set_strv("excluded-monitors", []); "x"'
run 'const w = global.get_window_actors().map(a => a.meta_window).find(w => w.get_wm_class()?.includes("Calc")); w.move_frame(true, -150, 300); "x"'
run 'fx().enabled = false; ui.queue_redraw(); "x"'; shot offedge-off 1.2
run 'fx().enabled = true; ui.queue_redraw(); "x"'; shot offedge-on 1.2
got=$(python3 -c "print($(mean offedge-on 1920x540+0+0) / $(mean offedge-off 1920x540+0+0))")
assert_near "window hanging off the edge: whole stage dimmed evenly" "$got" "$want" 0.01
run 's.set_strv("excluded-monitors", [dd._controller._monitors[1].connector]); "x"'
shot offedge-skip 1
assert_eq "paint box grew past the edge" "$(js 'String(fx()._box[0] < -2)')" true
for c in 958 959; do
    got=$(python3 -c "print($(mean offedge-skip 1x400+$c+100) / $(mean offedge-off 1x400+$c+100))")
    assert_near "off-edge window, exclusion boundary col $c dimmed" "$got" "$want" 0.02
done
for c in 960 961; do
    assert_near "off-edge window, exclusion boundary col $c untouched" \
        "$(mean offedge-skip 1x400+$c+100)" "$(mean offedge-off 1x400+$c+100)" 0.0005
done
run 's.set_strv("excluded-monitors", []); "x"'
run "$CALC w.minimize(); \"x\""

echo "5. colour controls"
run 's.set_double("level", 1); s.set_double("saturation", 0); "x"'; shot grey
assert_eq "greyscale keeps effect on at full level" "$(js 'fx()?.constructor.name')" DeepDimEffect
sat=$(convert "$SHOTS/grey.png" -crop 900x500+40+30 -colorspace HSL -channel G -separate -format '%[fx:mean]' info:)
assert_near "greyscale has no saturation" "$sat" 0 0.01
run 's.reset("saturation"); s.set_double("warmth", 1); "x"'; shot warm
read -r r b < <(convert "$SHOTS/warm.png" -format '%[fx:mean.r] %[fx:mean.b]\n' info:)
read -r r0 b0 < <(convert "$SHOTS/off.png" -format '%[fx:mean.r] %[fx:mean.b]\n' info:)
assert_near "warmth keeps red" "$r" "$r0" 0.01
assert_near "warmth cuts blue to 40 %" "$(python3 -c "print($b / $b0)")" 0.4 0.03
run 's.reset("warmth"); "x"'
assert_eq "neutral removes effect" "$(js 'String(fx() ?? null)')" null

echo "6. controller actions and shortcuts"
run 's.set_double("level", 0.5); dd._controller._onKeybinding("dim-darker"); "x"'
assert_near "darker steps by 5 %" "$(js 's.get_double("level")')" 0.45 0.0001
run 'dd._controller._onKeybinding("dim-brighter"); dd._controller._onKeybinding("dim-brighter"); "x"'
assert_near "brighter steps by 5 %" "$(js 's.get_double("level")')" 0.55 0.0001
run 'dd._controller._onKeybinding("dim-toggle"); "x"'
assert_eq "toggle turns off" "$(js 'String(s.get_boolean("enabled"))')" false
assert_eq "toggle off removes effect" "$(js 'String(fx() ?? null)')" null
run 'dd._controller._onKeybinding("dim-toggle"); "x"'
assert_eq "toggle turns on" "$(js 'String(s.get_boolean("enabled"))')" true
assert_eq "keybindings registered" "$(js 'String(["dim-darker","dim-brighter","dim-toggle"].every(k => Main.wm._allowedKeybindings[k] !== undefined))')" true
run 's.set_boolean("enabled", false); dd._controller._onKeybinding("dim-darker"); "x"'
assert_eq "darker while off turns on" "$(js 'String(s.get_boolean("enabled"))')" true
assert_near "darker while off starts from full" "$(js 's.get_double("level")')" 0.95 0.0001
run 's.set_double("level", 0.99); s.set_boolean("enabled", false); dd._controller.toggle(); "x"'
assert_near "toggle on from ~full uses default level" "$(js 's.get_double("level")')" 0.6 0.0001

echo "7. full-screen unredirect"
assert_eq "unredirect disabled while dimming" "$(js 'String(dd._controller._unredirectDisabled)')" true
run 's.set_boolean("enabled", false); "x"'
assert_eq "unredirect restored when off" "$(js 'String(dd._controller._unredirectDisabled)')" false
run 's.set_boolean("enabled", true); "x"'

echo "8. quick settings placement and UI"
assert_eq "slider in quick settings grid" \
    "$(js 'String(dd._indicator.slider.get_parent() === Main.panel.statusArea.quickSettings.menu._grid)')" true
run 'Main.panel.statusArea.quickSettings.menu.open(false); "x"'
sleep 0.5
assert_eq "slider directly after brightness" "$(js 'const g = Main.panel.statusArea.quickSettings.menu._grid; const kids = g.get_children(); const i = kids.indexOf(dd._indicator.slider); const b = kids.findIndex(k => k.constructor.name.includes("Brightness")); String(i === b + 1)')" true
assert_eq "slider shows level" "$(js 'String(Math.abs(dd._indicator.slider.slider.value - s.get_double("level")) < 1e-6)')" true
assert_eq "value label" "$(js 'dd._indicator.slider._valueLabel.text')" \
    "$(python3 -c "print(f'{round(0.01 ** (1 - 0.6) * 100)} %')")"
run 'Main.layoutManager.uiGroup.get_effect("deepdim-filter").enabled = false; "x"'
shot quicksettings 0.8
run 'dd._indicator.slider.menu.open(false); "x"'
shot quicksettings-menu 0.8
assert_eq "menu has screen switches" "$(js 'String(dd._indicator.slider._screensSection._getMenuItems().length)')" 2
run 'dd._indicator.slider.menu.close(false); Main.layoutManager.uiGroup.get_effect("deepdim-filter").enabled = true; "x"'
run 'dd._indicator.slider.slider.value = 0.2; "x"'
assert_near "dragging slider sets level" "$(js 's.get_double("level")')" 0.2 0.0001
run 'dd._indicator.slider.emit("icon-clicked"); "x"'
assert_eq "icon click toggles off" "$(js 'String(s.get_boolean("enabled"))')" false
assert_near "slider shows full when off" "$(js 'dd._indicator.slider.slider.value')" 1 0.0001
assert_eq "label says Off" "$(js 'dd._indicator.slider._valueLabel.text')" Off
run 'dd._indicator.slider.emit("icon-clicked"); Main.panel.statusArea.quickSettings.menu.close(false); "x"'
assert_eq "top bar icon visible while active" "$(js 'String(dd._indicator._indicator.visible)')" true

echo "9. disable / enable cycle"
run 'Main.extensionManager.disableExtension(ext.uuid); "x"'; sleep 0.5
assert_eq "disable removes effect" "$(js 'String(Main.layoutManager.uiGroup.get_effect("deepdim-filter") ?? null)')" null
assert_eq "disable removes slider" "$(js 'String(Main.panel.statusArea.quickSettings.menu._grid.get_children().some(c => c.constructor.name === "DeepDimSlider"))')" false
assert_eq "disable removes keybinding" "$(js 'String(Main.wm._allowedKeybindings["dim-toggle"])')" 0
run 'Main.extensionManager.enableExtension(ext.uuid); "x"'; sleep 0.5
assert_eq "re-enable restores effect" "$(js 'fx()?.constructor.name')" DeepDimEffect
assert_eq "re-enable has no error" "$(js 'ext.error || "none"')" none

echo "10. lock screen keeps dimming"
run 'Main.screenShield.lock(false); "x"'; sleep 2
assert_eq "session mode" "$(js 'Main.sessionMode.currentMode')" unlock-dialog
assert_eq "extension still enabled when locked" "$(js 'ext.state')" 1
assert_eq "effect still attached when locked" "$(js 'fx()?.constructor.name')" DeepDimEffect
run 'Main.screenShield._wakeUpScreen(); Main.screenShield._onUserBecameActive(); "x"'
shot locked-on 2
run 'fx().enabled = false; ui.queue_redraw(); "x"'; shot locked-off 1
run 'fx().enabled = true; ui.queue_redraw(); "x"'
got=$(python3 -c "print($(mean locked-on) / $(mean locked-off))")
assert_near "lock screen dimmed like the desktop" "$got" "$(python3 -c "print(0.01 ** ((1 - $(js 's.get_double("level")')) / 2.2))")" 0.02

echo "11. errors in the Shell log"
errs=$(/usr/bin/grep -iE "deepdim|deep dim" "$T/shell.log" | /usr/bin/grep -iE "error|warn|critical|exception" || true)
assert_eq "no Deep Dim errors in log" "${errs:-none}" none
[[ -n "$errs" ]] && echo "$errs" | head -20

echo
echo "$PASS passed, $FAIL failed. Screenshots: $SHOTS"
exit $(( FAIL > 0 ))

