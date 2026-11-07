// SPDX-License-Identifier: GPL-2.0-or-later
//
// Names and connectors for the monitors GNOME Shell knows about.
// Main.layoutManager.monitors gives geometry only, so this asks Mutter's
// DisplayConfig D-Bus service for connector names (stable keys for
// settings) and human display names, and matches them by position.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const BUS_NAME = 'org.gnome.Mutter.DisplayConfig';
const OBJECT_PATH = '/org/gnome/Mutter/DisplayConfig';
const STATE_TYPE = new GLib.VariantType('(ua((ssss)a(siiddada{sv})a{sv})a(iiduba(ssss)a{sv})a{sv})');

function fallback() {
    return Main.layoutManager.monitors.map(m => ({
        index: m.index,
        connector: `monitor-${m.index}`,
        name: `Screen ${m.index + 1}`,
        x: m.x,
        y: m.y,
        width: m.width,
        height: m.height,
    }));
}

/**
 * @param {Gio.Cancellable} cancellable
 * @returns {Promise<{index:number, connector:string, name:string,
 *   x:number, y:number, width:number, height:number}[]>}
 */
export function queryMonitors(cancellable = null) {
    return new Promise(resolve => {
        Gio.DBus.session.call(BUS_NAME, OBJECT_PATH, BUS_NAME, 'GetCurrentState',
            null, STATE_TYPE, Gio.DBusCallFlags.NONE, 2000, cancellable,
            (conn, res) => {
                let state;
                try {
                    state = conn.call_finish(res).deepUnpack();
                } catch (e) {
                    if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.warn(`Deep Dim: DisplayConfig unavailable: ${e.message}`);
                    resolve(fallback());
                    return;
                }
                resolve(parseState(state));
            });
    });
}

function parseState([, monitors, logicalMonitors]) {
    const names = new Map();
    for (const [[connector, vendor, product], , props] of monitors) {
        let name = props['display-name']?.deepUnpack?.() ?? '';
        if (!name)
            name = [vendor, product].filter(Boolean).join(' ') || connector;
        names.set(connector, name);
    }

    const result = Main.layoutManager.monitors.map(m => {
        const logical = logicalMonitors.find(([x, y]) => x === m.x && y === m.y);
        const connectors = logical ? logical[5].map(([c]) => c) : [];
        const connector = connectors[0] ?? `monitor-${m.index}`;
        let name = connectors.map(c => names.get(c) ?? c).join(' + ');
        if (!name)
            name = `Screen ${m.index + 1}`;
        const internal = /^(eDP|LVDS|DSI)/.test(connector);
        if (internal && !/built-in/i.test(name))
            name = `${name} (built-in)`;
        return {
            index: m.index,
            connector,
            name,
            x: m.x,
            y: m.y,
            width: m.width,
            height: m.height,
        };
    });

    // Two identical screens get the same display name; tell them apart.
    for (const m of result) {
        if (result.filter(o => o.name === m.name).length > 1)
            m.name = `${m.name} · ${m.connector}`;
    }
    return result;
}
