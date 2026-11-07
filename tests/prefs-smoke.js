// SPDX-License-Identifier: GPL-2.0-or-later
// Builds the preferences window against an in-memory settings backend,
// renders it to a PNG and checks that the widgets write the settings.
// Run: GSETTINGS_BACKEND=memory gjs -m tests/prefs-smoke.js <schema-dir> <out.png>
import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GdkX11 from 'gi://GdkX11?version=4.0';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import System from 'system';
import {buildPreferences} from '../prefs/preferences.js';

const [schemaDir, out] = ARGV;
const source = Gio.SettingsSchemaSource.new_from_directory(schemaDir,
    Gio.SettingsSchemaSource.get_default(), false);
const settings = new Gio.Settings({
    settings_schema: source.lookup('org.gnome.shell.extensions.deepdim', false),
});

let failures = 0;
const check = (name, cond) => {
    print(`${cond ? '  ok  ' : '  FAIL'} ${name}`);
    if (!cond)
        failures++;
};

function find(widget, pred, acc = []) {
    if (pred(widget))
        acc.push(widget);
    for (let c = widget.get_first_child(); c; c = c.get_next_sibling())
        find(c, pred, acc);
    return acc;
}

Adw.init();
const app = new Adw.Application({application_id: 'com.github.joseteo.DeepDimPrefsTest'});
app.connect('activate', () => {
    const window = new Adw.PreferencesWindow({application: app});
    buildPreferences(window, settings);
    window.present();

    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
        try {
            runChecks(window);
        } catch (e) {
            check(`no exception: ${e.message}\n${e.stack}`, false);
        }
        app.quit();
        return GLib.SOURCE_REMOVE;
    });
});

function runChecks(window) {
        const spins = find(window, w => w instanceof Adw.SpinRow);
        const switches = find(window, w => w instanceof Adw.SwitchRow);
        const scales = find(window, w => w instanceof Gtk.Scale);
        check('2 spin rows', spins.length === 2);
        check('4 switch rows', switches.length === 4);
        check('3 colour scales', scales.length === 3);

        const floorRow = spins.find(r => r.title === 'Darkest level (%)');
        check('darkest level shows 1 %', Math.abs(floorRow.adjustment.value - 1) < 1e-9);
        floorRow.adjustment.value = 0.5;
        check('darkest level writes 0.005', Math.abs(settings.get_double('floor') - 0.005) < 1e-9);
        settings.set_double('floor', 0.02);
        check('darkest level follows setting', Math.abs(floorRow.adjustment.value - 2) < 1e-9);

        scales[2].adjustment.value = 0.5;
        check('warmth scale writes setting', Math.abs(settings.get_double('warmth') - 0.5) < 1e-9);

        const dither = switches.find(r => r.title === 'Smooth dark gradients');
        dither.active = false;
        check('dither switch writes setting', settings.get_boolean('dither') === false);
        settings.reset('dither');
        settings.reset('warmth');
        settings.reset('floor');

        const labels = find(window, w => w instanceof Gtk.Label && w.get_css_classes().includes('dim-label'))
            .map(l => l.label);
        check('shortcut labels rendered', labels.some(l => l.includes('Page Down')));

        // Capture the real window from the X server (X11 hosts only).
        const surface = window.get_surface();
        if (out && surface instanceof GdkX11.X11Surface) {
            const xid = surface.get_xid();
            const [, , stderr, status] = GLib.spawn_sync(null,
                ['import', '-window', `${xid}`, out], null, GLib.SpawnFlags.SEARCH_PATH, null);
            check(`window captured (${new TextDecoder().decode(stderr).trim()})`, status === 0);
        } else {
            print(`  (no capture: surface is ${surface?.constructor.name})`);
        }
        const w = window.get_width(), h = window.get_height();
        print(`saved ${out} (${w}x${h})`);
}
app.run([]);
print(failures ? `${failures} failed` : 'all passed');
System.exit(failures ? 1 : 0);
