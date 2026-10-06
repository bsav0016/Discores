jest.mock('expo-linking', () => ({ createURL: (p: string) => `discores://${p}` }));
import { classifyLookup, codeFromUrl, inviteLink, normalizeCode } from './invite';

describe('invite links', () => {
  it('builds a link that normalizeCode can read back', () => {
    expect(inviteLink('K7M2QX9A')).toBe('discores://friend/K7M2QX9A');
  });
  it('accepts valid codes in any case with spaces', () => {
    expect(normalizeCode(' k7m2qx9a ')).toBe('K7M2QX9A');
    expect(normalizeCode(['K7M2QX9A'])).toBe('K7M2QX9A');
  });
  it('rejects wrong length, ambiguous characters and junk', () => {
    expect(normalizeCode('K7M2QX9')).toBeNull();
    expect(normalizeCode('K7M2QX9O')).toBeNull();
    expect(normalizeCode('K7M2QX90')).toBeNull();
    expect(normalizeCode('K7M2-X9A')).toBeNull();
    expect(normalizeCode(undefined)).toBeNull();
  });
});

describe('classifyLookup', () => {
  it('routes codes, emails and usernames', () => {
    expect(classifyLookup('K7M2QX9A')).toBe('code');
    expect(classifyLookup('sam@example.com')).toBe('email');
    expect(classifyLookup('@sam')).toBe('username');
    expect(classifyLookup('@samthrow')).toBe('username');
    expect(classifyLookup('sam_throws')).toBe('username');
  });
});

describe('codeFromUrl', () => {
  it('reads codes from custom-scheme and Expo Go links', () => {
    expect(codeFromUrl('discores://friend/K7M2QX9A')).toBe('K7M2QX9A');
    expect(codeFromUrl('exp://10.0.0.5:8081/--/friend/k7m2qx9a')).toBe('K7M2QX9A');
    expect(codeFromUrl('discores://friend/K7M2QX9A?x=1')).toBe('K7M2QX9A');
  });
  it('ignores other or malformed links', () => {
    expect(codeFromUrl('discores://round/abc')).toBeNull();
    expect(codeFromUrl('discores://friend/SHORT')).toBeNull();
    expect(codeFromUrl(null)).toBeNull();
  });
});
