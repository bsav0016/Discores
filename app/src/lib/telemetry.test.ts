jest.mock('expo-constants', () => ({ expoConfig: { version: '1.1.0' } }));
jest.mock('./supabase', () => ({ supabase: {} }));

import { createReporter, reportRpcFailure, type EventPayload } from './telemetry';

function setup(over: Partial<Parameters<typeof createReporter>[0]> = {}, answer: any = { data: 'ok', error: null }) {
  const sent: EventPayload[] = [];
  const report = createReporter({
    send: async (p) => { sent.push(p); return answer; },
    isSignedIn: async () => true,
    platform: 'ios',
    version: '1.1.0',
    ...over,
  });
  return { sent, report };
}

describe('reporter', () => {
  it('sends a scrubbed event with only the allowed fields', async () => {
    const { sent, report } = setup();
    await report('sync', 'sync.rejected', 'round 3f2b8c1e-9a4d-4e6f-8b1a-0c2d3e4f5a6b by sam@example.com');
    expect(sent).toEqual([{
      p_kind: 'sync', p_code: 'sync.rejected', p_message: 'round [id] by [email]', p_app_version: '1.1.0', p_platform: 'ios',
    }]);
  });

  it('sends nothing for guests, on web, or when reporting throws', async () => {
    const guest = setup({ isSignedIn: async () => false });
    await guest.report('error', 'x');
    expect(guest.sent).toEqual([]);

    const web = setup({ platform: 'web' });
    await web.report('error', 'x');
    expect(web.sent).toEqual([]);

    const broken = setup({ isSignedIn: async () => { throw new Error('store'); } });
    await expect(broken.report('error', 'x')).resolves.toBeUndefined();
    await broken.report('error', 'y');
    expect(broken.sent).toEqual([]);
  });

  it('sends a repeated failure once, and at most maxPerRun in all', async () => {
    const { sent, report } = setup({ maxPerRun: 3 });
    await report('error', 'a', 'same');
    await report('error', 'a', 'same');
    await report('error', 'b');
    await report('error', 'c');
    await report('error', 'd');
    expect(sent.map((e) => e.p_code)).toEqual(['a', 'b', 'c']);
  });

  it('stops for the run when the server errors (not deployed yet) or limits us', async () => {
    const missing = setup({}, { data: null, error: { code: 'PGRST202', message: 'function not found' } });
    await missing.report('error', 'a');
    await missing.report('error', 'b');
    expect(missing.sent).toHaveLength(1);

    const limited = setup({}, { data: 'limited', error: null });
    await limited.report('error', 'a');
    await limited.report('error', 'b');
    expect(limited.sent).toHaveLength(1);
  });

  it('counts an event before sending it, so a crash loop cannot flood the server', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const sent: EventPayload[] = [];
    const report = createReporter({
      send: async (p) => { sent.push(p); await gate; return { data: 'ok', error: null }; },
      isSignedIn: async () => true, platform: 'android', version: '1', maxPerRun: 2,
    });
    const all = [1, 2, 3, 4].map((i) => report('crash', `c${i}`));
    release();
    await Promise.all(all);
    expect(sent).toHaveLength(2);
  });
});

describe('reportRpcFailure', () => {
  it('does not throw for a network failure or a missing error', () => {
    expect(() => reportRpcFailure('rpc.x', { message: 'Network request failed', code: '' })).not.toThrow();
    expect(() => reportRpcFailure('rpc.x', null)).not.toThrow();
  });
});
