// SPDX-License-Identifier: GPL-2.0-or-later
//
// Deep Dim: dim screens below the hardware minimum with a colour-matrix
// shader, controlled from Quick Settings next to the brightness slider.

import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import * as CM from './lib/colorMatrix.js';
import {DimEffect, MAX_SKIP_RECTS} from './lib/dimEffect.js';
import {queryMonitors} from './lib/monitors.js';
import {DimIndicator, placeAfterBrightness} from './lib/quickSettings.js';

const EFFECT_NAME = 'deepdim-filter';
const DEFAULT_ON_LEVEL = 0.6;
const KEYBINDINGS = ['dim-darker', 'dim-brighter', 'dim-toggle'];

class DimController {
    constructor(extension) {
        this._extension = extension;
        this._settings = extension.getSettings();
        this._effect = null;
        this._unredirectDisabled = false;
        this._monitors = [];
        this._indicator = null;
        this._cancellable = new Gio.Cancellable();

        this._settingsId = this._settings.connect('changed', (s, key) => {
            if (!KEYBINDINGS.includes(key) && key !== 'step')
                this._update();
        });
        this._monitorsId = Main.layoutManager.connect('monitors-changed',
            () => this._refreshMonitors());
    }

    setIndicator(indicator) {
        this._indicator = indicator;
        indicator.slider.setMonitors(this._monitors);
        this._update();
    }

    start() {
        this._refreshMonitors();
        this._update();
        for (const name of KEYBINDINGS) {
            Main.wm.addKeybinding(name, this._settings, Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.ALL, () => this._onKeybinding(name));
        }
    }

    // ---- user actions -------------------------------------------------

    setLevelFromUser(value) {
        const level = CM.clamp(value, 0, 1);
        if (!this._settings.get_boolean('enabled'))
            this._settings.set_boolean('enabled', true);
        this._settings.set_double('level', level);
    }

    toggle() {
        if (this._settings.get_boolean('enabled')) {
            this._settings.set_boolean('enabled', false);
            return;
        }
        if (this._settings.get_double('level') > 0.98)
            this._settings.set_double('level', DEFAULT_ON_LEVEL);
        this._settings.set_boolean('enabled', true);
    }

    step(direction) {
        const enabled = this._settings.get_boolean('enabled');
        const current = enabled ? this._settings.get_double('level') : 1;
        const step = this._settings.get_double('step');
        const level = CM.clamp(current + direction * step, 0, 1);
        this.setLevelFromUser(level);
    }

    resetColour() {
        for (const key of ['contrast', 'saturation', 'warmth'])
            this._settings.reset(key);
    }

    setMonitorDimmed(connector, dimmed) {
        const excluded = new Set(this._settings.get_strv('excluded-monitors'));
        if (dimmed)
            excluded.delete(connector);
        else
            excluded.add(connector);
        this._settings.set_strv('excluded-monitors', [...excluded]);
    }

    _onKeybinding(name) {
        if (name === 'dim-darker')
            this.step(-1);
        else if (name === 'dim-brighter')
            this.step(1);
        else
            this.toggle();
        this._showOsd();
    }

    _showOsd() {
        const enabled = this._settings.get_boolean('enabled');
        const level = this._settings.get_double('level');
        const floor = this._settings.get_double('floor');
        const icon = this._extension.icon(enabled ? 'deepdim-symbolic' : 'deepdim-off-symbolic');
        const label = enabled
            ? `Dim ${Math.round(CM.luminanceForLevel(level, floor) * 1000) / 10} %`
            : 'Dimming off';
        Main.osdWindowManager.show(-1, icon, label, enabled ? level : 1, 1);
    }

    // ---- filter -------------------------------------------------------

    async _refreshMonitors() {
        const monitors = await queryMonitors(this._cancellable);
        if (this._cancellable.is_cancelled())
            return;
        this._monitors = monitors;
        this._indicator?.slider.setMonitors(monitors);
        this._update();
    }

    _currentParams() {
        if (!this._settings.get_boolean('enabled'))
            return CM.NEUTRAL;
        return {
            level: this._settings.get_double('level'),
            contrast: this._settings.get_double('contrast'),
            saturation: this._settings.get_double('saturation'),
            warmth: this._settings.get_double('warmth'),
        };
    }

    _skipRects() {
        const excluded = new Set(this._settings.get_strv('excluded-monitors'));
        return this._monitors.filter(m => excluded.has(m.connector));
    }

    _update() {
        const params = this._currentParams();
        const skip = this._skipRects();
        const allSkipped = this._monitors.length > 0 && skip.length >= this._monitors.length;
        const active = !CM.isNeutral(params) && !allSkipped;

        if (active) {
            const floor = this._settings.get_double('floor');
            const matrix = CM.buildMatrix(params, floor);
            const dither = CM.ditherAmplitude(matrix.scale, this._settings.get_boolean('dither'));
            this._attach();
            this._effect.setMatrix(matrix, dither);
            this._effect.setSkipRects(skip.slice(0, MAX_SKIP_RECTS));
        } else {
            this._detach();
        }

        this._setUnredirect(active && this._settings.get_boolean('keep-fullscreen-dimmed'));
        this._indicator?.setActive(active && this._settings.get_boolean('show-indicator'));
    }

    _attach() {
        if (this._effect)
            return;
        this._effect = new DimEffect();
        Main.layoutManager.uiGroup.add_effect_with_name(EFFECT_NAME, this._effect);
    }

    _detach() {
        if (!this._effect)
            return;
        Main.layoutManager.uiGroup.remove_effect(this._effect);
        this._effect = null;
    }

    _setUnredirect(disable) {
        if (disable === this._unredirectDisabled)
            return;
        if (disable)
            Meta.disable_unredirect_for_display(global.display);
        else
            Meta.enable_unredirect_for_display(global.display);
        this._unredirectDisabled = disable;
    }

    destroy() {
        this._cancellable.cancel();
        for (const name of KEYBINDINGS)
            Main.wm.removeKeybinding(name);
        this._settings.disconnect(this._settingsId);
        Main.layoutManager.disconnect(this._monitorsId);
        this._detach();
        this._setUnredirect(false);
        this._indicator = null;
        this._monitors = [];
        this._cancellable = null;
        this._settings = null;
        this._extension = null;
    }
}

export default class DeepDimExtension extends Extension {
    enable() {
        this._controller = new DimController(this);
        this._indicator = new DimIndicator(this, this._controller);

        const quickSettings = Main.panel.statusArea.quickSettings;
        quickSettings.addExternalIndicator(this._indicator, 2);
        placeAfterBrightness(this._indicator.slider);
        // Other extensions (ddcutil) add their sliders later; re-check on open.
        this._menuOpenId = quickSettings.menu.connect('open-state-changed', (m, open) => {
            if (open)
                placeAfterBrightness(this._indicator.slider);
        });

        this._controller.setIndicator(this._indicator);
        this._controller.start();
    }

    disable() {
        // Deep Dim keeps running in the unlock-dialog session mode on purpose:
        // the lock screen is drawn by the Shell like everything else, so without
        // the filter, locking or waking the screen at night would flash it at full
        // brightness. On the lock screen the extension only keeps its shader and
        // its three Mutter keybindings (darker, brighter, on/off). The on/off
        // binding is the way back if the screen was made too dark to read the
        // unlock prompt. No keyboard event signals are connected at any time;
        // keybindings only fire for their own accelerators.
        Main.panel.statusArea.quickSettings.menu.disconnect(this._menuOpenId);
        this._menuOpenId = null;
        this._controller.destroy();
        this._controller = null;
        this._indicator.destroy();
        this._indicator = null;
        this._icons = null;
    }

    /** Gio.Icon for one of the bundled symbolic icons. */
    icon(name) {
        this._icons ??= new Map();
        if (!this._icons.has(name)) {
            const file = this.dir.get_child('icons').get_child(`${name}.svg`);
            this._icons.set(name, new Gio.FileIcon({file}));
        }
        return this._icons.get(name);
    }
}
