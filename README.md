# Deep Dim

A GNOME Shell 46 extension that dims your screens **below the lowest brightness
the hardware allows**, down to almost black. It puts a colour-matrix shader
over everything GNOME Shell draws, so it works on any screen: laptop panels,
external monitors over HDMI or DisplayPort, and projectors.

The slider sits in Quick Settings, directly under the brightness slider (the
built-in one, or the ones from *Brightness control using ddcutil*).

## Use it

| Where | What |
| --- | --- |
| Quick Settings slider | Right is full brightness (filter off), left is the darkest level. The label shows the light that is left, for example `10 %`. |
| Moon button left of the slider | Turns dimming on or off and keeps the level. |
| Arrow right of the slider | Contrast, colour intensity, warmth, a switch per screen, reset, settings. |
| `Super+Alt+Page Down` / `Shift+Brightness Down` | Darker, with an on-screen meter. |
| `Super+Alt+Page Up` / `Shift+Brightness Up` | Brighter. |
| `Super+Alt+End` | On or off. **Use this if you ever go too dark to see.** |

The shortcuts work everywhere, including full-screen apps and the lock screen.
You can change them in the settings.

Use the backlight first and Deep Dim for what is left: set the hardware
brightness to its minimum, then slide Deep Dim down.

## How it works

For every pixel `c = (r, g, b)` the shader computes `c' = M·c + offset`. The
3×3 matrix `M` and the offset combine four controls (`lib/colorMatrix.js`):

1. **Colour intensity**: a Rec. 709 saturation matrix, 0 % is greyscale.
2. **Contrast**: `k·c + (1−k)·0.5`, pulling whites and blacks towards grey.
3. **Warmth**: per-channel gains down to green 70 % and blue 40 % (about 2700 K).
4. **Dimming**: one gain for all three channels.

The slider is logarithmic, like the eye: with the default darkest level of 1 %,
the middle of the slider gives 10 % of the light. Pixel values are
gamma-encoded, so the gain is `luminance^(1/2.2)`. At strong dimming, one level
of noise is added so dark gradients don't band.

The effect sits on `Main.layoutManager.uiGroup`: windows, panel, dock,
overview, notifications and the lock screen. The filter is removed completely
when everything is neutral, so it costs nothing while off. While it is on:

* full-screen windows are kept composited, so games and videos stay dimmed
  (you can turn this off in the settings);
* each monitor is rendered separately, so windows that span two screens stay
  correct, and a screen you exclude keeps its pixels untouched.

## Limits

* **The mouse pointer is not dimmed.** It is a hardware cursor plane that
  GNOME Shell doesn't draw.
* Screenshots and screen recordings taken by GNOME Shell may include the
  dimming.
* While dimming, every frame goes through one extra full-screen pass on the
  GPU. That is small on any modern GPU, but measurable on battery.
* At very strong dimming, 8-bit output only has a few dozen levels left. The
  noise hides the banding but adds a faint grain.
* The darkest level is a fraction of the light at the current backlight
  setting, not an absolute value in nits.

## Install

```sh
./install.sh            # copies to ~/.local/share/gnome-shell/extensions and enables
```

GNOME 46 only discovers new extensions at startup: on X11 press `Alt+F2`, type
`r` and press Enter. On Wayland, log out and back in.

`./build.sh` makes an installable zip in `dist/` for `gnome-extensions install`.

## Tests

```sh
gjs -m tests/test-color-matrix.js                         # colour math, 47 checks
GDK_BACKEND=x11 GSETTINGS_BACKEND=memory \
  gjs -m tests/prefs-smoke.js <compiled-schema-dir> out.png   # settings window
tests/nested-test.sh                                       # end-to-end, 54 checks
```

`nested-test.sh` starts a throwaway nested GNOME Shell with two 960×540
screens, its own settings file and a test-only helper extension
(`tests/helper`, never install it in a real session) that allows driving the
Shell over D-Bus. It measures real composited pixels from the host X server.
It checks that:

* the dimming ratio matches the maths to 0.01;
* excluded screens are untouched, to the exact pixel column and row;
* a window that spans two screens, or hangs off an edge, renders correctly;
* greyscale and warmth come out right;
* the shortcuts and toggle work;
* full-screen unredirection is handled;
* the slider is placed after the brightness slider;
* disabling and re-enabling the extension cleans up;
* the lock screen stays dimmed;
* there are no errors in the Shell log.

## Licence

GPL-2.0-or-later.
