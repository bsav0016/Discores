const { OPTIONAL_FEATURES } = require('./withOptionalHardware');

// withAndroidManifest only registers a mod; call the mod the plugin registers against a fake manifest.
jest.mock('expo/config-plugins', () => ({
  withAndroidManifest: (config, action) => action({ ...config, modResults: config.__manifest }),
}));
const withOptionalHardware = require('./withOptionalHardware');

const run = (manifest) => withOptionalHardware({ __manifest: { manifest } }).modResults.manifest['uses-feature'];

describe('withOptionalHardware', () => {
  test('declares portrait and Wi-Fi as not required', () => {
    const features = run({});
    expect(features).toHaveLength(OPTIONAL_FEATURES.length);
    for (const f of features) expect(f.$['android:required']).toBe('false');
    expect(features.map((f) => f.$['android:name']).sort()).toEqual([...OPTIONAL_FEATURES].sort());
  });

  test('keeps other features and replaces a stricter declaration of the same one', () => {
    const features = run({
      'uses-feature': [
        { $: { 'android:name': 'android.hardware.camera', 'android:required': 'false' } },
        { $: { 'android:name': 'android.hardware.wifi', 'android:required': 'true' } },
      ],
    });
    const byName = Object.fromEntries(features.map((f) => [f.$['android:name'], f.$['android:required']]));
    expect(byName['android.hardware.camera']).toBe('false');
    expect(byName['android.hardware.wifi']).toBe('false');
    expect(features.filter((f) => f.$['android:name'] === 'android.hardware.wifi')).toHaveLength(1);
  });
});
