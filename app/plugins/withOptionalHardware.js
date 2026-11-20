// Google Play adds a hardware requirement to the app for each thing it can infer from the manifest: portrait-only
// screens (the app is locked to portrait) and Wi-Fi (the connectivity library asks for the Wi-Fi state permission).
// Neither is something the app needs to run, and each one hides it from some devices (landscape-only TVs and
// Chromebooks, devices without Wi-Fi). Declaring them "not required" keeps the app available to those devices.
const { withAndroidManifest } = require('expo/config-plugins');

const OPTIONAL_FEATURES = ['android.hardware.screen.portrait', 'android.hardware.wifi'];

function withOptionalHardware(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const existing = (manifest['uses-feature'] || []).filter((f) => !OPTIONAL_FEATURES.includes(f.$['android:name']));
    manifest['uses-feature'] = [
      ...existing,
      ...OPTIONAL_FEATURES.map((name) => ({ $: { 'android:name': name, 'android:required': 'false' } })),
    ];
    return cfg;
  });
}

module.exports = withOptionalHardware;
module.exports.OPTIONAL_FEATURES = OPTIONAL_FEATURES;
