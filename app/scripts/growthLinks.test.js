const { tagStoreLink } = require('./growthLinks');

const APPLE = 'https://apps.apple.com/us/app/discores-disc-golf-scorecard/id6820334635';
const PLAY = 'https://play.google.com/store/apps/details?id=com.discores.app';

describe('tagStoreLink', () => {
  it('adds a campaign to an App Store link', () => {
    const url = new URL(tagStoreLink(APPLE, 'web-home'));
    expect(url.pathname).toBe('/us/app/discores-disc-golf-scorecard/id6820334635');
    expect(url.searchParams.get('ct')).toBe('web-home');
  });

  it('adds the install referrer to a Google Play link and keeps the app id', () => {
    const url = new URL(tagStoreLink(PLAY, 'web-faq'));
    expect(url.searchParams.get('id')).toBe('com.discores.app');
    expect(url.searchParams.get('referrer')).toBe('utm_source=web-faq&utm_medium=organic&utm_campaign=web-faq');
  });

  it('leaves other addresses alone', () => {
    expect(tagStoreLink('https://example.test/a', 'web-home')).toBe('https://example.test/a');
    expect(tagStoreLink('not a url', 'web-home')).toBe('not a url');
  });

  it('refuses a campaign name the stores would mangle', () => {
    expect(() => tagStoreLink(APPLE, 'Web Home')).toThrow();
    expect(() => tagStoreLink(APPLE, 'a'.repeat(41))).toThrow();
    expect(() => tagStoreLink(APPLE, '')).toThrow();
  });
});
