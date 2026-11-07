// SPDX-License-Identifier: GPL-2.0-or-later
//
// The screen filter: an offscreen GLSL effect that applies a 3x3 colour
// matrix plus offset to every pixel of the actor it is attached to
// (Main.layoutManager.uiGroup, which holds windows, panels, overview and
// the lock screen).
//
// Screens can be skipped. Clutter renders the actor into a texture that
// covers the actor's paint box (the bounding box of everything it draws,
// padded by Clutter), so a fragment's texture coordinate maps back to a
// stage position as  box.xy + st * box.wh. The box changes when windows
// hang off a screen edge, so it is refreshed on every paint.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';

export const MAX_SKIP_RECTS = 4;

const DECLARATIONS = `
uniform vec3 dd_row0;
uniform vec3 dd_row1;
uniform vec3 dd_row2;
uniform vec3 dd_offset;
uniform float dd_dither;
uniform vec4 dd_box;
uniform vec4 dd_skip0;
uniform vec4 dd_skip1;
uniform vec4 dd_skip2;
uniform vec4 dd_skip3;

float dd_rand(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123);
}

bool dd_inside(vec4 r, vec2 p) {
  return r.z > 0.0 &&
    p.x >= r.x && p.y >= r.y && p.x < r.x + r.z && p.y < r.y + r.w;
}
`;

const CODE = `
vec2 dd_pos = dd_box.xy + cogl_tex_coord_in[0].st * dd_box.zw;
if (!(dd_inside(dd_skip0, dd_pos) || dd_inside(dd_skip1, dd_pos) ||
      dd_inside(dd_skip2, dd_pos) || dd_inside(dd_skip3, dd_pos))) {
  vec3 dd_c = cogl_color_out.rgb;
  float dd_a = cogl_color_out.a;
  vec3 dd_m = vec3(dot(dd_row0, dd_c), dot(dd_row1, dd_c), dot(dd_row2, dd_c));
  dd_m += dd_offset * dd_a;
  dd_m += (dd_rand(gl_FragCoord.xy) - 0.5) * dd_dither * dd_a;
  cogl_color_out.rgb = clamp(dd_m, 0.0, dd_a);
}
`;

/**
 * The box Clutter's offscreen effect actually renders into, as
 * _clutter_actor_box_enlarge_for_effects() computes it: a stable integer
 * size, padded so sub-pixel drawing never leaks out. Returns [x, y, w, h].
 */
export function enlargeForEffects(x1, y1, x2, y2) {
    const width = Math.round(x2 - x1);
    const height = Math.round(y2 - y1);
    const ex2 = Math.ceil(x2 + 0.75);
    const ey2 = Math.ceil(y2 + 0.75);
    return [ex2 - width - 3, ey2 - height - 3, width + 3, height + 3];
}

const UNIFORMS = ['dd_row0', 'dd_row1', 'dd_row2', 'dd_offset', 'dd_dither',
    'dd_box', 'dd_skip0', 'dd_skip1', 'dd_skip2', 'dd_skip3'];

export const DimEffect = GObject.registerClass(
class DeepDimEffect extends Shell.GLSLEffect {
    _init(params) {
        super._init(params);

        this._loc = {};
        for (const name of UNIFORMS)
            this._loc[name] = this.get_uniform_location(name);

        this._box = [];
        this._hasSkips = false;
        this.setMatrix({rows: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], offset: [0, 0, 0]}, 0);
        this.setSkipRects([]);
    }

    vfunc_build_pipeline() {
        this.add_glsl_snippet(Shell.SnippetHook.FRAGMENT, DECLARATIONS, CODE, false);
    }

    // Mutter paints every monitor (stage view) separately and culls each
    // window to the view being painted. The offscreen texture would
    // otherwise be rendered once, for the first view, and reused for the
    // others, losing whatever that first view culled away (a window
    // straddling two screens loses its half on the second screen). Force a
    // fresh offscreen render for each view.
    vfunc_paint(node, paintContext, flags) {
        if (this._hasSkips)
            this._updateBox();
        super.vfunc_paint(node, paintContext, flags | Clutter.EffectPaintFlags.ACTOR_DIRTY);
    }

    _updateBox() {
        const actor = this.get_actor();
        if (!actor)
            return;
        const [ok, box] = actor.get_paint_box();
        const value = ok
            ? enlargeForEffects(box.x1, box.y1, box.x2, box.y2)
            : enlargeForEffects(0, 0, global.stage.width, global.stage.height);
        if (value.every((v, i) => v === this._box[i]))
            return;
        this._box = value;
        this.set_uniform_float(this._loc.dd_box, 4, value);
    }

    /**
     * @param {{rows: number[][], offset: number[]}} matrix from colorMatrix.buildMatrix
     * @param {number} dither noise amplitude in encoded units
     */
    setMatrix(matrix, dither) {
        this.set_uniform_float(this._loc.dd_row0, 3, matrix.rows[0]);
        this.set_uniform_float(this._loc.dd_row1, 3, matrix.rows[1]);
        this.set_uniform_float(this._loc.dd_row2, 3, matrix.rows[2]);
        this.set_uniform_float(this._loc.dd_offset, 3, matrix.offset);
        this.set_uniform_float(this._loc.dd_dither, 1, [dither]);
        this.queue_repaint();
    }

    /**
     * @param {{x: number, y: number, width: number, height: number}[]} rects
     *   areas in the actor's coordinates to leave unfiltered
     */
    setSkipRects(rects) {
        for (let i = 0; i < MAX_SKIP_RECTS; i++) {
            const r = rects[i];
            const value = r ? [r.x, r.y, r.width, r.height] : [0, 0, 0, 0];
            this.set_uniform_float(this._loc[`dd_skip${i}`], 4, value);
        }
        this._hasSkips = rects.length > 0;
        this._box = [];
        if (this._hasSkips)
            this._updateBox();
        this.queue_repaint();
    }
});
