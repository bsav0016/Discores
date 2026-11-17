// Turns the numbers from growth_report() (migration 0030) into the weekly Markdown message. Pure, so it is tested;
// growth-report.js fetches the numbers and writes the file.

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** "▲ 3", "▼ 2" or "same", against last week. */
function change(now, before) {
  const d = num(now) - num(before);
  if (d === 0) return 'same';
  return `${d > 0 ? '▲' : '▼'} ${Math.abs(d)}`;
}

function row(label, now, before) {
  return `| ${label} | ${num(now)} | ${num(before)} | ${change(now, before)} |`;
}

/** The weekly message. `report` is the object growth_report() returns; missing sections count as zero. */
function formatReport(report, { date = new Date() } = {}) {
  const r = report || {};
  const g = (section, field) => (r[section] ? r[section][field] : 0);
  const day = date.toISOString().slice(0, 10);
  const lines = [
    `## Week ending ${day}`,
    '',
    '| | This week | Last week | Change |',
    '| --- | ---: | ---: | --- |',
    row('New accounts', g('accounts', 'new_this_week'), g('accounts', 'new_prev_week')),
    row('Rounds started', g('rounds', 'started_this_week'), g('rounds', 'started_prev_week')),
    row('Rounds with 2+ registered players', g('rounds', 'with_friends_this_week'), g('rounds', 'with_friends_prev_week')),
    row('Players who played', g('players', 'active_this_week'), g('players', 'active_prev_week')),
    row('App errors and crashes', g('errors', 'this_week'), g('errors', 'prev_week')),
    '',
    `**Totals:** ${num(g('accounts', 'total'))} accounts, ${num(g('friends', 'friendships_total'))} friendships ` +
      `(${num(g('friends', 'accepted_new_this_week'))} new this week), ${num(g('notifications', 'phones_registered'))} phones with notifications on, ` +
      `${num(g('courses', 'total'))} courses (${num(g('courses', 'confirmed_pars'))} with confirmed pars, ` +
      `${num(g('courses', 'added_by_players_this_week'))} added by players this week).`,
    `Rounds finished this week: ${num(g('rounds', 'finished_this_week'))} of ${num(g('rounds', 'started_this_week'))} started.`,
    '',
    '_Counts from the database only. Guest rounds stay on the phone and are not included; deleted accounts and rounds are gone from the totals._',
  ];
  return lines.join('\n');
}

module.exports = { formatReport, change };
