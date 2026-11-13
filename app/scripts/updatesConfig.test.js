/**
 * Guards the over-the-air update setup. Nothing here talks to Expo: it only checks that the config a
 * release build is made from still has what updates need, so a cleanup cannot silently turn them off.
 */
const app = require('../app.json').expo;
const eas = require('../eas.json');
const pkg = require('../package.json');

describe('over-the-air updates', () => {
  test('has expo-updates installed', () => {
    expect(pkg.dependencies['expo-updates']).toBeDefined();
  });

  test('points at this project\'s EAS update endpoint', () => {
    expect(app.updates.url).toBe(`https://u.expo.dev/${app.extra.eas.projectId}`);
  });

  test('only delivers an update to builds of the same app version', () => {
    // If this became a fixed string or were removed, JS needing new native code could reach builds without it.
    expect(app.runtimeVersion).toEqual({ policy: 'appVersion' });
  });

  test('builds each shipped profile for its own channel', () => {
    expect(eas.build.production.channel).toBe('production');
    expect(eas.build.preview.channel).toBe('preview');
  });

  test('never lets a preview build listen to the production channel', () => {
    const channels = Object.values(eas.build).map((profile) => profile.channel);
    expect(new Set(channels).size).toBe(channels.length);
  });

  // The Supabase address and public key are read from the build environment, which for store builds is the
  // profile's env block. The publish script hands the same block to the update, so it has to stay filled in.
  test('the production profile carries the public Supabase settings an update needs', () => {
    expect(eas.build.production.env.EXPO_PUBLIC_SUPABASE_URL).toMatch(/^https:\/\/.+\.supabase\.co$/);
    expect(eas.build.production.env.EXPO_PUBLIC_SUPABASE_ANON_KEY).toBeTruthy();
  });
});
