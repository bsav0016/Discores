import { SITE_URL, inviteMessage, roundShareMessage } from './share';

describe('roundShareMessage', () => {
  const base = { courseName: 'Maple Hill', total: 54, relative: 3, holesPlayed: 18, holeCount: 18 };

  it('shares the sender\'s own score and course, with the site link', () => {
    expect(roundShareMessage(base)).toBe(
      `I shot 54 (+3) at Maple Hill on Discores, a free disc golf scorecard that works offline with no ads.\n${SITE_URL}`);
  });

  it('shows under par and even, and says so when not every hole was played', () => {
    expect(roundShareMessage({ ...base, total: 51, relative: -3 })).toContain('I shot 51 (-3) at Maple Hill');
    expect(roundShareMessage({ ...base, total: 54, relative: 0 })).toContain('I shot 54 (E) at Maple Hill');
    expect(roundShareMessage({ ...base, holesPlayed: 9, total: 28, relative: 1 }))
      .toContain("I'm 28 (+1) through 9 holes at Maple Hill");
  });

  it('never carries anything but the sender\'s result', () => {
    const msg = roundShareMessage(base);
    expect(msg.split('\n')).toHaveLength(2);
    expect(msg).not.toMatch(/friend code|discores:\/\//i);
  });
});

describe('inviteMessage', () => {
  it('points to the public site for someone without the app, and adds the code when there is one', () => {
    expect(inviteMessage(null, null)).toContain(`Get it: ${SITE_URL}`);
    expect(inviteMessage(null, null)).not.toContain('friend code');
    const withCode = inviteMessage('K7M2QX9A', 'discores://friend/K7M2QX9A');
    expect(withCode).toContain('Then add my friend code: K7M2QX9A');
    expect(withCode).toContain('Already have it? discores://friend/K7M2QX9A');
    expect(inviteMessage('K7M2QX9A', null)).not.toContain('Already have it');
  });
});
