const { planUpdate, CHANNELS } = require('../scripts/updatePlan');

const HEAD = 'a'.repeat(40);
const expoConfig = {
  updates: { url: 'https://u.expo.dev/project' },
  runtimeVersion: { policy: 'appVersion' },
};
const facts = (overrides = {}) => ({
  channel: 'preview',
  branch: 'main',
  releaseBranch: 'main',
  dirty: false,
  head: HEAD,
  originMain: HEAD,
  subject: 'Fix button spacing',
  expoConfig,
  ...overrides,
});

describe('planUpdate', () => {
  test('a clean tree on the release branch may go to either channel', () => {
    for (const channel of CHANNELS) {
      const plan = planUpdate(facts({ channel }));
      expect(plan.errors).toEqual([]);
      expect(plan.command).toEqual([
        'eas-cli', 'update', '--channel', channel, '--environment', channel,
        '--message', 'aaaaaaa Fix button spacing', '--non-interactive',
      ]);
    }
  });

  test('passes the build profile environment through to every command', () => {
    const buildEnv = { EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co' };
    expect(planUpdate(facts({ buildEnv })).env).toEqual(buildEnv);
    expect(planUpdate(facts()).env).toEqual({});
  });

  test('reports the runtime version as JSON', () => {
    expect(planUpdate(facts()).runtimeVersion).toBe('{"policy":"appVersion"}');
  });

  test('refuses an unknown channel', () => {
    const plan = planUpdate(facts({ channel: 'staging' }));
    expect(plan.command).toBeNull();
    expect(plan.errors.join(' ')).toMatch(/Channel must be one of/);
  });

  test('refuses uncommitted changes on any channel', () => {
    for (const channel of CHANNELS) {
      const plan = planUpdate(facts({ channel, dirty: true }));
      expect(plan.command).toBeNull();
      expect(plan.errors.join(' ')).toMatch(/uncommitted/);
    }
  });

  test('preview may be published from a feature branch', () => {
    const plan = planUpdate(facts({ channel: 'preview', branch: 'feat/thing', originMain: 'b'.repeat(40) }));
    expect(plan.errors).toEqual([]);
    expect(plan.command).not.toBeNull();
  });

  test('production is only published from the release branch', () => {
    const plan = planUpdate(facts({ channel: 'production', branch: 'feat/thing' }));
    expect(plan.command).toBeNull();
    expect(plan.errors.join(' ')).toMatch(/published from main/);
  });

  test('production needs HEAD to equal the remote release branch', () => {
    const behind = planUpdate(facts({ channel: 'production', originMain: 'b'.repeat(40) }));
    expect(behind.command).toBeNull();
    expect(behind.errors.join(' ')).toMatch(/not the same as origin\/main/);

    const unknown = planUpdate(facts({ channel: 'production', originMain: null }));
    expect(unknown.command).toBeNull();
    expect(unknown.errors.join(' ')).toMatch(/Could not read origin\/main/);
  });

  test('refuses when the app has no update configuration', () => {
    for (const config of [{}, { updates: { url: 'u' } }, { runtimeVersion: 'x' }, undefined]) {
      const plan = planUpdate(facts({ expoConfig: config }));
      expect(plan.command).toBeNull();
      expect(plan.errors.join(' ')).toMatch(/updates\.url \/ runtimeVersion/);
    }
  });

  test('reports every problem at once', () => {
    const plan = planUpdate(facts({ channel: 'production', branch: 'feat/x', dirty: true, originMain: null }));
    expect(plan.errors.length).toBeGreaterThanOrEqual(3);
  });
});
