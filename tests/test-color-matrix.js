// SPDX-License-Identifier: GPL-2.0-or-later
// Run: gjs -m tests/test-color-matrix.js
import * as CM from '../lib/colorMatrix.js';
import System from 'system';

let failures = 0;
let passes = 0;

function near(a, b, tol = 1e-6) {
    return Math.abs(a - b) <= tol;
}

function check(name, cond, detail = '') {
    if (cond) {
        passes++;
    } else {
        failures++;
        print(`FAIL ${name} ${detail}`);
    }
}

function checkVec(name, got, want, tol = 1e-6) {
    const ok = got.length === want.length && got.every((v, i) => near(v, want[i], tol));
    check(name, ok, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}

// Luminance curve
check('lum p=1 is 1', near(CM.luminanceForLevel(1, 0.01), 1));
check('lum p=0 is floor', near(CM.luminanceForLevel(0, 0.01), 0.01));
check('lum p=0.5 is sqrt(floor)', near(CM.luminanceForLevel(0.5, 0.01), 0.1));
check('lum clamps level>1', near(CM.luminanceForLevel(2, 0.01), 1));
check('lum clamps level<0', near(CM.luminanceForLevel(-1, 0.01), 0.01));
check('lum NaN level -> floor', near(CM.luminanceForLevel(NaN, 0.01), 0.01));
check('lum floor clamped low', near(CM.luminanceForLevel(0, 0), CM.LIMITS.floor[0]));
check('lum monotonic', [0, 0.1, 0.2, 0.5, 0.8, 1].every((p, i, a) =>
    i === 0 || CM.luminanceForLevel(p, 0.01) > CM.luminanceForLevel(a[i - 1], 0.01)));
for (const p of [0, 0.25, 0.5, 0.9, 1])
    check(`level round trip ${p}`, near(CM.levelForLuminance(CM.luminanceForLevel(p, 0.02), 0.02), p, 1e-9));

// Encoded scale
check('scale of 1 is 1', near(CM.encodedScale(1), 1));
check('scale gamma', near(CM.encodedScale(0.01) ** CM.GAMMA, 0.01));

// Neutral detection
check('neutral default', CM.isNeutral({}));
check('neutral exact', CM.isNeutral(CM.NEUTRAL));
check('not neutral level', !CM.isNeutral({level: 0.9}));
check('not neutral contrast', !CM.isNeutral({contrast: 0.9}));
check('not neutral saturation', !CM.isNeutral({saturation: 0.5}));
check('not neutral warmth', !CM.isNeutral({warmth: 0.1}));

// Neutral matrix is identity
const id = CM.buildMatrix(CM.NEUTRAL, 0.01);
checkVec('identity row0', id.rows[0], [1, 0, 0]);
checkVec('identity row1', id.rows[1], [0, 1, 0]);
checkVec('identity row2', id.rows[2], [0, 0, 1]);
checkVec('identity offset', id.offset, [0, 0, 0]);
checkVec('identity pixel', CM.applyMatrix(id, [0.3, 0.6, 0.9]), [0.3, 0.6, 0.9]);

// Pure dimming scales white to the encoded scale and keeps black black
const dim = CM.buildMatrix({level: 0}, 0.01);
const s = CM.encodedScale(0.01);
checkVec('dim white', CM.applyMatrix(dim, [1, 1, 1]), [s, s, s]);
checkVec('dim black', CM.applyMatrix(dim, [0, 0, 0]), [0, 0, 0]);
check('dim white luminance is floor', near(CM.applyMatrix(dim, [1, 1, 1])[0] ** CM.GAMMA, 0.01));
check('dim keeps contrast ratio', near(
    CM.applyMatrix(dim, [0.5, 0.5, 0.5])[0] / CM.applyMatrix(dim, [1, 1, 1])[0], 0.5));

// Greyscale keeps luma and equalises channels
const grey = CM.buildMatrix({saturation: 0}, 0.01);
const red = CM.applyMatrix(grey, [1, 0, 0]);
checkVec('greyscale red', red, [0.2126, 0.2126, 0.2126]);
checkVec('greyscale white stays white', CM.applyMatrix(grey, [1, 1, 1]), [1, 1, 1]);

// Contrast pulls towards 0.5
const flat = CM.buildMatrix({contrast: 0.5}, 0.01);
checkVec('contrast white', CM.applyMatrix(flat, [1, 1, 1]), [0.75, 0.75, 0.75]);
checkVec('contrast black', CM.applyMatrix(flat, [0, 0, 0]), [0.25, 0.25, 0.25]);
checkVec('contrast mid fixed', CM.applyMatrix(flat, [0.5, 0.5, 0.5]), [0.5, 0.5, 0.5]);
const flatClamped = CM.buildMatrix({contrast: 0}, 0.01);
checkVec('contrast clamped to limit', CM.applyMatrix(flatClamped, [1, 1, 1]),
    [0.65, 0.65, 0.65]);

// Warmth reduces blue most, green less, red not at all
const warm = CM.buildMatrix({warmth: 1}, 0.01);
const w = CM.applyMatrix(warm, [1, 1, 1]);
check('warm red full', near(w[0], 1));
check('warm green reduced', w[1] < 1 && w[1] > w[2]);
check('warm blue most reduced', near(w[2], 0.4));

// Combination stays in range
const all = CM.buildMatrix({level: 0, contrast: 0.3, saturation: 0, warmth: 1}, 0.0005);
for (const px of [[0, 0, 0], [1, 1, 1], [1, 0, 0], [0, 0, 1]]) {
    const out = CM.applyMatrix(all, px);
    check(`combo in range ${px}`, out.every(v => v >= 0 && v <= 1));
}
check('combo darkest white below 3% encoded', CM.applyMatrix(all, [1, 1, 1])[0] < 0.1);

// Dither
check('dither off when disabled', CM.ditherAmplitude(0.1, false) === 0);
check('dither off when bright', CM.ditherAmplitude(0.9, true) === 0);
check('dither one step when dark', near(CM.ditherAmplitude(0.1, true), 1 / 255));

print(`${passes} passed, ${failures} failed`);
System.exit(failures ? 1 : 0);
