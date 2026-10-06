import { isSessionGone } from './session';

describe('isSessionGone', () => {
  it('is true when the server says the user or token is gone', () => {
    expect(isSessionGone({ status: 403 })).toBe(true); // user_not_found after account deletion
    expect(isSessionGone({ status: 401 })).toBe(true);
    expect(isSessionGone({ status: 404 })).toBe(true);
  });

  it('is false for offline and server trouble, so people stay signed in on the course', () => {
    expect(isSessionGone({ status: 0 })).toBe(false); // supabase-js reports network failures as status 0
    expect(isSessionGone({})).toBe(false);
    expect(isSessionGone({ status: 502 })).toBe(false);
    expect(isSessionGone({ status: 503 })).toBe(false);
  });

  it('is false when there is no error', () => {
    expect(isSessionGone(null)).toBe(false);
    expect(isSessionGone(undefined)).toBe(false);
  });
});
