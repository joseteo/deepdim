// SPDX-License-Identifier: GPL-2.0-or-later
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {buildPreferences} from './prefs/preferences.js';

export default class DeepDimPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        buildPreferences(window, this.getSettings());
    }
}
