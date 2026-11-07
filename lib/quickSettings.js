// SPDX-License-Identifier: GPL-2.0-or-later
//
// Quick Settings UI: a slider that sits under the brightness slider(s),
// with a menu for contrast, colour intensity, warmth and per-screen
// switches, plus a top bar icon while dimming is active.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {QuickSlider, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

import * as CM from './colorMatrix.js';

const BRIGHTNESS_ICON = 'display-brightness-symbolic';

function formatPercent(fraction) {
    const pct = fraction * 100;
    if (pct >= 10)
        return `${Math.round(pct)} %`;
    if (pct >= 1)
        return `${pct.toFixed(1)} %`;
    return `${pct.toFixed(2)} %`;
}

/** A labelled slider row inside the slider's menu. */
const MenuSliderItem = GObject.registerClass(
class DeepDimMenuSliderItem extends PopupMenu.PopupBaseMenuItem {
    _init(label, {min, max, settings, key, format}) {
        super._init({activate: false, style_class: 'deepdim-menu-slider'});
        this._min = min;
        this._max = max;
        this._settings = settings;
        this._key = key;
        this._format = format;

        const box = new St.BoxLayout({vertical: true, x_expand: true});
        const header = new St.BoxLayout({x_expand: true});
        this._label = new St.Label({text: label, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._value = new St.Label({style_class: 'deepdim-value', y_align: Clutter.ActorAlign.CENTER});
        header.add_child(this._label);
        header.add_child(this._value);
        box.add_child(header);

        this.slider = new Slider(0);
        this.slider.accessible_name = label;
        box.add_child(this.slider);
        this.add_child(box);

        this._changedId = this.slider.connect('notify::value', () => {
            const v = this._min + this.slider.value * (this._max - this._min);
            this._settings.set_double(this._key, v);
        });
        this._settingsId = settings.connect(`changed::${key}`, () => this._sync());
        this.connect('destroy', () => settings.disconnect(this._settingsId));
        this._sync();
    }

    _sync() {
        const v = this._settings.get_double(this._key);
        this.slider.block_signal_handler(this._changedId);
        this.slider.value = (v - this._min) / (this._max - this._min);
        this.slider.unblock_signal_handler(this._changedId);
        this._value.text = this._format(v);
    }
});

export const DimSlider = GObject.registerClass(
class DeepDimSlider extends QuickSlider {
    _init(extension, controller) {
        super._init({
            gicon: extension.icon('deepdim-symbolic'),
            iconReactive: true,
            iconLabel: 'Turn dimming on or off',
            menuEnabled: true,
        });
        this.add_style_class_name('deepdim-slider');
        this._extension = extension;
        this._controller = controller;
        this._settings = extension.getSettings();

        this.slider.accessible_name = 'Deep Dim';

        // Value label between the slider and the menu arrow
        const box = this.slider.get_parent().get_parent();
        this._valueLabel = new St.Label({
            style_class: 'deepdim-slider-value',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.insert_child_above(this._valueLabel, this.slider.get_parent());

        this._sliderChangedId = this.slider.connect('notify::value',
            () => this._controller.setLevelFromUser(this.slider.value));
        this.connect('icon-clicked', () => this._controller.toggle());

        this._buildMenu();

        this._settingsIds = ['enabled', 'level', 'floor'].map(key =>
            this._settings.connect(`changed::${key}`, () => this._sync()));
        this._sync();
    }

    _buildMenu() {
        this.menu.setHeader(this._extension.icon('deepdim-symbolic'), 'Deep Dim',
            'Below-minimum brightness');

        const pct = v => `${Math.round(v * 100)} %`;
        const filter = new PopupMenu.PopupMenuSection();
        filter.addMenuItem(new MenuSliderItem('Contrast', {
            min: CM.LIMITS.contrast[0], max: 1, settings: this._settings,
            key: 'contrast', format: pct,
        }));
        filter.addMenuItem(new MenuSliderItem('Colour intensity', {
            min: 0, max: 1, settings: this._settings, key: 'saturation', format: pct,
        }));
        filter.addMenuItem(new MenuSliderItem('Warmth', {
            min: 0, max: 1, settings: this._settings, key: 'warmth', format: pct,
        }));
        this.menu.addMenuItem(filter);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Screens'));
        this._screensSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._screensSection);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction('Reset colour controls', () => this._controller.resetColour());
        this.menu.addAction('Dimming Settings', () => {
            Main.panel.closeQuickSettings?.();
            this._extension.openPreferences();
        });
    }

    /** @param {{connector: string, name: string}[]} monitors */
    setMonitors(monitors) {
        this._screensSection.removeAll();
        const excluded = new Set(this._settings.get_strv('excluded-monitors'));
        for (const m of monitors) {
            const item = new PopupMenu.PopupSwitchMenuItem(m.name, !excluded.has(m.connector));
            item.connect('toggled', (o, state) => this._controller.setMonitorDimmed(m.connector, state));
            this._screensSection.addMenuItem(item);
        }
    }

    _sync() {
        const enabled = this._settings.get_boolean('enabled');
        const level = this._settings.get_double('level');
        const floor = this._settings.get_double('floor');
        const shown = enabled ? level : 1;

        this.slider.block_signal_handler(this._sliderChangedId);
        this.slider.value = shown;
        this.slider.unblock_signal_handler(this._sliderChangedId);

        this.gicon = this._extension.icon(enabled ? 'deepdim-symbolic' : 'deepdim-off-symbolic');
        this._valueLabel.text = enabled ? formatPercent(CM.luminanceForLevel(level, floor)) : 'Off';
        this.iconLabel = enabled ? 'Turn dimming off' : 'Turn dimming on';
    }

    destroy() {
        this._settingsIds?.forEach(id => this._settings.disconnect(id));
        this._settingsIds = null;
        super.destroy();
    }
});

export const DimIndicator = GObject.registerClass(
class DeepDimIndicator extends SystemIndicator {
    _init(extension, controller) {
        super._init();
        this._indicator = this._addIndicator();
        this._indicator.gicon = extension.icon('deepdim-symbolic');
        this._indicator.visible = false;

        this.slider = new DimSlider(extension, controller);
        this.quickSettingsItems.push(this.slider);
    }

    setActive(active) {
        this._indicator.visible = active;
    }

    destroy() {
        this.quickSettingsItems.forEach(item => item.destroy());
        super.destroy();
    }
});

function isBrightnessSlider(actor) {
    if (!(actor instanceof QuickSlider) || actor instanceof DimSlider)
        return false;
    const icon = actor.iconName ?? actor.gicon?.to_string?.() ?? '';
    return icon.includes('brightness') || actor.constructor.name.includes('Brightness');
}

/**
 * Put the slider directly under the last visible brightness slider
 * (built-in or added by other extensions such as ddcutil). Falls back to
 * the hidden built-in one, then to the last full-width slider.
 */
export function placeAfterBrightness(item) {
    const grid = item.get_parent();
    if (!grid)
        return;
    const children = grid.get_children().filter(c => c !== item);
    const brightness = children.filter(isBrightnessSlider);
    const anchor = brightness.filter(c => c.visible).at(-1) ??
        brightness.at(-1) ??
        children.filter(c => c instanceof QuickSlider).at(-1);
    if (anchor && anchor.get_parent() === grid)
        grid.set_child_above_sibling(item, anchor);
}
