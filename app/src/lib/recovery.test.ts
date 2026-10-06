import { parseRecoveryUrl, passwordProblem } from './recovery';

describe('parseRecoveryUrl', () => {
  it('reads the session from the fragment', () => {
    expect(parseRecoveryUrl('discores://reset-password#access_token=AAA&refresh_token=BBB&type=recovery&expires_in=3600'))
      .toEqual({ accessToken: 'AAA', refreshToken: 'BBB' });
    expect(parseRecoveryUrl('exp://10.0.0.5:8081/--/reset-password#access_token=A.B.C&refresh_token=r&type=recovery'))
      .toEqual({ accessToken: 'A.B.C', refreshToken: 'r' });
  });
  it('reports an expired or used link', () => {
    const r = parseRecoveryUrl('discores://reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    expect(r && 'error' in r).toBe(true);
  });
  it('ignores other links, or a link missing its tokens', () => {
    expect(parseRecoveryUrl('discores://friend/K7M2QX9A')).toBeNull();
    expect(parseRecoveryUrl('discores://reset-password')).toBeNull();
    expect(parseRecoveryUrl('discores://reset-password#access_token=A&type=recovery')).toBeNull();
    expect(parseRecoveryUrl(null)).toBeNull();
  });
});

describe('passwordProblem', () => {
  it('needs 8 characters that match', () => {
    expect(passwordProblem('short', 'short')).toMatch(/at least 8/);
    expect(passwordProblem('longenough', 'different1')).toMatch(/match/);
    expect(passwordProblem('longenough', 'longenough')).toBeNull();
  });
});
