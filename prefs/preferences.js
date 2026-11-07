// SPDX-License-Identifier: GPL-2.0-or-later
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

function percentSpinRow(settings, key, title, subtitle, {min, max, step, digits}) {
    const adjustment = new Gtk.Adjustment({
        lower: min * 100,
        upper: max * 100,
        step_increment: step * 100,
        page_increment: step * 1000,
    });
    const row = new Adw.SpinRow({title, subtitle, adjustment, digits});
    const sync = () => {
        adjustment.value = settings.get_double(key) * 100;
    };
    sync();
    const id = settings.connect(`changed::${key}`, sync);
    row.connect('destroy', () => settings.disconnect(id));
    adjustment.connect('value-changed', () => {
        const v = adjustment.value / 100;
        if (Math.abs(v - settings.get_double(key)) > 1e-9)
            settings.set_double(key, v);
    });
    return row;
}

function scaleRow(settings, key, title, subtitle, min, max) {
    const row = new Adw.ActionRow({title, subtitle});
    const scale = new Gtk.Scale({
        orientation: Gtk.Orientation.HORIZONTAL,
        adjustment: new Gtk.Adjustment({lower: min, upper: max, step_increment: 0.01, page_increment: 0.1}),
        draw_value: true,
        digits: 2,
        hexpand: false,
        width_request: 240,
        valign: Gtk.Align.CENTER,
    });
    scale.set_format_value_func((s, v) => `${Math.round(v * 100)} %`);
    settings.bind(key, scale.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
    row.add_suffix(scale);
    return row;
}

function switchRow(settings, key, title, subtitle) {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

const ShortcutRow = GObject.registerClass(
class DeepDimShortcutRow extends Adw.ActionRow {
    _init(settings, key, title) {
        super._init({title});
        this._settings = settings;
        this._key = key;

        this._label = new Gtk.Label({valign: Gtk.Align.CENTER, css_classes: ['dim-label']});
        this.add_suffix(this._label);

        const edit = new Gtk.Button({
            icon_name: 'document-edit-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: 'Set shortcut',
            css_classes: ['flat'],
        });
        edit.connect('clicked', () => this._capture());
        this.add_suffix(edit);

        const reset = new Gtk.Button({
            icon_name: 'edit-undo-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: 'Restore default',
            css_classes: ['flat'],
        });
        reset.connect('clicked', () => settings.reset(key));
        this.add_suffix(reset);

        const id = settings.connect(`changed::${key}`, () => this._sync());
        this.connect('destroy', () => settings.disconnect(id));
        this._sync();
    }

    _sync() {
        const accels = this._settings.get_strv(this._key);
        const labels = accels.map(a => {
            const [ok, keyval, mods] = Gtk.accelerator_parse(a);
            return ok ? Gtk.accelerator_get_label(keyval, mods) : a;
        });
        this._label.label = labels.length ? labels.join('  or  ') : 'Disabled';
    }

    _capture() {
        const dialog = new Adw.Window({
            modal: true,
            transient_for: this.get_root(),
            default_width: 420,
            default_height: 200,
            title: 'Set shortcut',
        });
        const status = new Adw.StatusPage({
            title: this.title,
            description: 'Press the new shortcut.\nEsc cancels, Backspace disables.',
            icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic',
        });
        dialog.set_content(status);

        const controller = new Gtk.EventControllerKey();
        controller.connect('key-pressed', (c, keyval, keycode, state) => {
            const mods = state & Gtk.accelerator_get_default_mod_mask();
            if (mods === 0 && keyval === Gdk.KEY_Escape) {
                dialog.close();
                return Gdk.EVENT_STOP;
            }
            if (mods === 0 && keyval === Gdk.KEY_BackSpace) {
                this._settings.set_strv(this._key, []);
                dialog.close();
                return Gdk.EVENT_STOP;
            }
            if (!Gtk.accelerator_valid(keyval, mods) && !isFunctionKey(keyval))
                return Gdk.EVENT_STOP;
            this._settings.set_strv(this._key, [Gtk.accelerator_name(keyval, mods)]);
            dialog.close();
            return Gdk.EVENT_STOP;
        });
        dialog.add_controller(controller);
        dialog.present();
    }
});

function isFunctionKey(keyval) {
    const name = Gdk.keyval_name(keyval) ?? '';
    return /^XF86|^F\d+$/.test(name);
}

export function buildPreferences(window, settings) {
    window.set_default_size(640, 760);
    window.set_title('Deep Dim');
    const page = new Adw.PreferencesPage({title: 'Deep Dim', icon_name: 'weather-clear-night-symbolic'});
    window.add(page);

    const dimming = new Adw.PreferencesGroup({
        title: 'Dimming',
        description: 'The slider in Quick Settings goes from full brightness on the right to the darkest level on the left.',
    });
    dimming.add(switchRow(settings, 'enabled', 'Dimming on', 'Same as the moon button next to the slider'));
    dimming.add(percentSpinRow(settings, 'floor', 'Darkest level (%)',
        'Percent of the light the screen gives at its current backlight, at the far left of the slider',
        {min: 0.0005, max: 0.5, step: 0.005, digits: 2}));
    dimming.add(percentSpinRow(settings, 'step', 'Shortcut step (%)',
        'How far each shortcut press moves the slider',
        {min: 0.01, max: 0.25, step: 0.01, digits: 0}));
    page.add(dimming);

    const colour = new Adw.PreferencesGroup({
        title: 'Colour',
        description: 'Applied together with the dimming, through the same colour matrix.',
    });
    colour.add(scaleRow(settings, 'contrast', 'Contrast', 'Lower pulls whites and blacks towards grey', 0.3, 1));
    colour.add(scaleRow(settings, 'saturation', 'Colour intensity', '0 % is greyscale', 0, 1));
    colour.add(scaleRow(settings, 'warmth', 'Warmth', 'Cuts blue and green light', 0, 1));
    const resetColour = new Gtk.Button({label: 'Reset colour', valign: Gtk.Align.CENTER});
    resetColour.connect('clicked', () => ['contrast', 'saturation', 'warmth'].forEach(k => settings.reset(k)));
    colour.set_header_suffix(resetColour);
    page.add(colour);

    const behaviour = new Adw.PreferencesGroup({title: 'Behaviour'});
    behaviour.add(switchRow(settings, 'dither', 'Smooth dark gradients',
        'Adds a faint noise at strong dimming so gradients do not band'));
    behaviour.add(switchRow(settings, 'keep-fullscreen-dimmed', 'Keep full-screen apps dimmed',
        'Full-screen games and videos would otherwise skip the filter'));
    behaviour.add(switchRow(settings, 'show-indicator', 'Top bar icon',
        'Show a moon in the top bar while dimming is active'));
    page.add(behaviour);

    const shortcuts = new Adw.PreferencesGroup({
        title: 'Shortcuts',
        description: 'They work everywhere, including the lock screen and full-screen apps.',
    });
    shortcuts.add(new ShortcutRow(settings, 'dim-darker', 'Darker'));
    shortcuts.add(new ShortcutRow(settings, 'dim-brighter', 'Brighter'));
    shortcuts.add(new ShortcutRow(settings, 'dim-toggle', 'Turn on or off'));
    page.add(shortcuts);
}
