// Test only: lets tests/nested-test.sh drive the nested Shell via Eval.
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export default class TestHelper {
    enable() {
        // No banners: they would change the pixels between captures.
        Main.messageTray.bannerBlocked = true;
        global.context.unsafe_mode = true;
    }

    disable() {
        global.context.unsafe_mode = false;
        Main.messageTray.bannerBlocked = false;
    }
}
