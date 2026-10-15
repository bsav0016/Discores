import { checkDisplayName, defaultDisplayName, MAX_DISPLAY_NAME } from './displayName';

describe('defaultDisplayName', () => {
  it('uses the part of the email before the @', () => {
    expect(defaultDisplayName('sam.rivers@example.com')).toBe('sam.rivers');
  });
  it('never exceeds what the server accepts', () => {
    const long = `${'a'.repeat(60)}@example.com`;
    expect(defaultDisplayName(long)).toHaveLength(MAX_DISPLAY_NAME);
  });
  it('falls back to Player when there is nothing before the @', () => {
    expect(defaultDisplayName('@example.com')).toBe('Player');
    expect(defaultDisplayName('')).toBe('Player');
  });
});

describe('checkDisplayName', () => {
  it('trims and collapses spaces', () => {
    expect(checkDisplayName('  Sam   Rivers ')).toEqual({ name: 'Sam Rivers' });
  });
  it('rejects a blank name', () => {
    expect(checkDisplayName('   ')).toEqual({ error: 'Enter a name.' });
  });
  it('rejects a name that is too long', () => {
    const r = checkDisplayName('x'.repeat(MAX_DISPLAY_NAME + 1));
    expect('error' in r).toBe(true);
    expect(checkDisplayName('x'.repeat(MAX_DISPLAY_NAME))).toEqual({ name: 'x'.repeat(MAX_DISPLAY_NAME) });
  });
});
