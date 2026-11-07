// SPDX-License-Identifier: GPL-2.0-or-later
//
// Pure colour-matrix math for Deep Dim. No GNOME imports, so it can be unit
// tested with plain `gjs -m`.
//
// The shader works on the gamma-encoded (sRGB-ish) pixel values the
// compositor already holds. For every pixel c = (r, g, b):
//
//     c' = M · c + offset · alpha
//
// M and offset are built here from four user-facing controls:
//   level       slider position, 0 = darkest allowed, 1 = no dimming
//   contrast    1 = unchanged, lower values pull every channel towards grey
//   saturation  1 = unchanged, 0 = greyscale ("colour intensity")
//   warmth      0 = unchanged, 1 = strongly reduced blue and green

export const GAMMA = 2.2;

// Rec. 709 luma weights, used for the saturation matrix.
const LUMA = [0.2126, 0.7152, 0.0722];

// Channel gains at full warmth. Roughly a 2700 K white point, close to what
// GNOME Night Light uses at its warmest.
const WARM_GREEN = 0.70;
const WARM_BLUE = 0.40;

export const NEUTRAL = Object.freeze({
    level: 1,
    contrast: 1,
    saturation: 1,
    warmth: 0,
});

export const LIMITS = Object.freeze({
    floor: [0.0005, 0.5],
    contrast: [0.3, 1],
    saturation: [0, 1],
    warmth: [0, 1],
});

const EPSILON = 1e-4;

export function clamp(value, min, max) {
    if (!Number.isFinite(value))
        return min;
    return Math.min(max, Math.max(min, value));
}

/**
 * Luminance fraction (0..1] that a slider position produces.
 *
 * The mapping is logarithmic so that each step of the slider changes the
 * perceived brightness by a similar amount, the way the eye works. With
 * floor = 0.01: p=1 -> 100 %, p=0.5 -> 10 %, p=0 -> 1 %.
 *
 * @param {number} level slider position 0..1
 * @param {number} floor darkest luminance fraction allowed
 * @returns {number}
 */
export function luminanceForLevel(level, floor) {
    const p = clamp(level, 0, 1);
    const f = clamp(floor, ...LIMITS.floor);
    return f ** (1 - p);
}

/** Inverse of luminanceForLevel. */
export function levelForLuminance(luminance, floor) {
    const f = clamp(floor, ...LIMITS.floor);
    const l = clamp(luminance, f, 1);
    return 1 - Math.log(l) / Math.log(f);
}

/**
 * Factor to multiply gamma-encoded values by to get the given luminance.
 * Encoded value v shows luminance v^GAMMA, so (k·v)^GAMMA = L·v^GAMMA
 * gives k = L^(1/GAMMA).
 */
export function encodedScale(luminance) {
    return clamp(luminance, 0, 1) ** (1 / GAMMA);
}

export function isNeutral(params) {
    const p = {...NEUTRAL, ...params};
    return Math.abs(p.level - 1) < EPSILON &&
        Math.abs(p.contrast - 1) < EPSILON &&
        Math.abs(p.saturation - 1) < EPSILON &&
        Math.abs(p.warmth) < EPSILON;
}

function multiply3(a, b) {
    const out = [];
    for (let i = 0; i < 3; i++) {
        out.push([0, 1, 2].map(j =>
            a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j]));
    }
    return out;
}

export function saturationMatrix(s) {
    const k = clamp(s, ...LIMITS.saturation);
    return [0, 1, 2].map(i => [0, 1, 2].map(j =>
        (1 - k) * LUMA[j] + (i === j ? k : 0)));
}

export function warmthGains(w) {
    const k = clamp(w, ...LIMITS.warmth);
    return [1, 1 - (1 - WARM_GREEN) * k, 1 - (1 - WARM_BLUE) * k];
}

/**
 * Build the 3x3 matrix (row-major) and the offset vector.
 *
 * Order of operations on a pixel c:
 *   1. saturation  S·c
 *   2. contrast    k·S·c + (1-k)·0.5
 *   3. warmth and brightness, a per-channel gain g_i = scale · warmth_i
 *
 * @param {object} params {level, contrast, saturation, warmth}
 * @param {number} floor darkest luminance fraction
 * @returns {{rows: number[][], offset: number[], scale: number, luminance: number}}
 */
export function buildMatrix(params, floor) {
    const p = {...NEUTRAL, ...params};
    const luminance = luminanceForLevel(p.level, floor);
    const scale = encodedScale(luminance);
    const k = clamp(p.contrast, ...LIMITS.contrast);
    const gains = warmthGains(p.warmth).map(g => g * scale);

    const gain = [[gains[0], 0, 0], [0, gains[1], 0], [0, 0, gains[2]]];
    const s = saturationMatrix(p.saturation);
    const rows = multiply3(gain, s).map(row => row.map(v => v * k));
    const offset = gains.map(g => g * (1 - k) * 0.5);

    return {rows, offset, scale, luminance};
}

/** Apply a built matrix to one opaque pixel, the same way the shader does. */
export function applyMatrix(matrix, rgb) {
    return matrix.rows.map((row, i) => clamp(
        row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2] + matrix.offset[i],
        0, 1));
}

/**
 * Dither amplitude in encoded units. Below ~40 % encoded scale the output
 * only spans a few dozen of the 256 levels, so banding becomes visible;
 * one quantisation step of noise hides it. Above that it is unnecessary.
 */
export function ditherAmplitude(scale, enabled) {
    if (!enabled || scale > 0.6)
        return 0;
    return 1 / 255;
}
