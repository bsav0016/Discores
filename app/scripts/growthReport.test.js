const { formatReport, change } = require('./growthReport');

const report = {
  accounts: { total: 120, new_this_week: 9, new_prev_week: 4 },
  rounds: { started_this_week: 30, started_prev_week: 35, finished_this_week: 28, with_friends_this_week: 6, with_friends_prev_week: 6 },
  players: { active_this_week: 22, active_prev_week: 20 },
  friends: { friendships_total: 51, accepted_new_this_week: 5 },
  notifications: { phones_registered: 0 },
  courses: { total: 3116, confirmed_pars: 2, added_by_players_this_week: 1 },
  errors: { this_week: 3, prev_week: 0 },
};

describe('change', () => {
  it('shows direction and size, or "same"', () => {
    expect(change(9, 4)).toBe('▲ 5');
    expect(change(30, 35)).toBe('▼ 5');
    expect(change(6, 6)).toBe('same');
    expect(change(undefined, 2)).toBe('▼ 2');
  });
});

describe('formatReport', () => {
  const md = formatReport(report, { date: new Date('2026-11-23T12:00:00Z') });

  it('has the week, the comparison table and the totals', () => {
    expect(md).toContain('## Week ending 2026-11-23');
    expect(md).toContain('| New accounts | 9 | 4 | ▲ 5 |');
    expect(md).toContain('| Rounds started | 30 | 35 | ▼ 5 |');
    expect(md).toContain('| Rounds with 2+ registered players | 6 | 6 | same |');
    expect(md).toContain('| App errors and crashes | 3 | 0 | ▲ 3 |');
    expect(md).toContain('**Totals:** 120 accounts, 51 friendships (5 new this week), 0 phones with notifications on, 3116 courses (2 with confirmed pars, 1 added by players this week).');
    expect(md).toContain('Rounds finished this week: 28 of 30 started.');
  });

  it('copes with missing sections and says what is left out', () => {
    const empty = formatReport({}, { date: new Date('2026-11-23T00:00:00Z') });
    expect(empty).toContain('| New accounts | 0 | 0 | same |');
    expect(empty).toContain('Guest rounds stay on the phone');
    expect(() => formatReport(null)).not.toThrow();
  });
});
