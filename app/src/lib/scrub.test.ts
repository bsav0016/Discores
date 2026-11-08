import { cleanCode, MAX_MESSAGE, scrubMessage } from './scrub';

describe('scrubMessage', () => {
  const cases: [string, string, string[]][] = [
    ['an email', 'Could not add sam.smith+disc@example.co.uk as a friend', ['sam.smith', 'example.co.uk']],
    ['a uuid', 'round 3f2b8c1e-9a4d-4e6f-8b1a-0c2d3e4f5a6b belongs to another user', ['3f2b8c1e', '0c2d3e4f5a6b']],
    ['a JWT', 'bad token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123_-xyz', ['eyJ', 'abcDEF']],
    ['an Expo push token', 'register failed for ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]', ['xxxxxxxx', 'ExponentPushToken']],
    ['a url with a query', 'GET https://abc.supabase.co/rest/v1/rounds?id=eq.5&apikey=secretvalue failed', ['supabase.co', 'secretvalue']],
    ['an app link', 'opened discores://friend/ABCD2345', ['ABCD2345']],
    ['a unix path', 'ENOENT at /data/user/0/com.discores.app/files/SQLite/discores.db', ['/data', 'discores.db']],
    ['a windows path', 'cannot read C:\\Users\\Brian\\app\\x.js', ['Brian', 'C:\\']],
    ['a long key', 'key sb_publishable_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123 rejected', ['ABCDEFGHIJ']],
    ['a phone number', 'sms to 5025551234 failed', ['5025551234']],
    ['an IP', 'connect to 192.168.1.20 refused', ['192.168']],
  ];
  it.each(cases)('removes %s', (_name, input, forbidden) => {
    const out = scrubMessage(input);
    for (const f of forbidden) expect(out).not.toContain(f);
    expect(out.length).toBeGreaterThan(0);
  });

  it('keeps the useful, non-personal part', () => {
    expect(scrubMessage('new row violates check constraint "round_players_position_check"'))
      .toBe('new row violates check constraint "round_players_position_check"');
    expect(scrubMessage('A round needs 1 to 36 holes with par 2 to 6')).toBe('A round needs 1 to 36 holes with par 2 to 6');
    expect(scrubMessage('a / b')).toBe('a / b');
  });

  it('accepts errors, objects with a message, and rubbish', () => {
    expect(scrubMessage(new Error('boom'))).toBe('boom');
    expect(scrubMessage({ message: 'from supabase' })).toBe('from supabase');
    expect(scrubMessage(null)).toBe('');
    expect(scrubMessage(undefined)).toBe('');
    expect(scrubMessage(42)).toBe('42');
    const hostile = { get message(): string { throw new Error('no'); } };
    expect(scrubMessage(hostile)).toBe('');
  });

  it('caps the length, even for a huge message, quickly', () => {
    const start = Date.now();
    const out = scrubMessage('word '.repeat(100000));
    expect(out.length).toBeLessThanOrEqual(MAX_MESSAGE);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('never lets a fragment through when the match is split by the cut', () => {
    const out = scrubMessage('x'.repeat(990) + ' sam@example.com');
    expect(out).not.toContain('sam@');
  });
});

describe('cleanCode', () => {
  it('produces a code the server accepts', () => {
    for (const c of ['rpc.list_friends', 'Has Space!', '', 'é', 'a'.repeat(100)]) {
      expect(cleanCode(c)).toMatch(/^[a-z0-9_.:-]{1,64}$/);
    }
    expect(cleanCode('RPC.List Friends')).toBe('rpc.list_friends');
  });
});
