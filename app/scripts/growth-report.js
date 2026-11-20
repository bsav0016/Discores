// Fetches the weekly numbers and writes the Markdown report. Run by the Growth report workflow.
//
//   GROWTH_REPORT_KEY=... node app/scripts/growth-report.js report.md
//
// Needs the same public Supabase URL and anon key the app ships with (default: app/eas.json), plus the secret report
// key. The key is only ever sent to the growth_report() function; it is never printed.
const fs = require('node:fs');
const path = require('node:path');
const { formatReport } = require('./growthReport');

function publicSettings() {
  let env = {};
  try {
    env = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'eas.json'), 'utf8')).build.production.env;
  } catch {
    // optional when the environment provides both values
  }
  const url = process.env.SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('No Supabase URL and anon key: set SUPABASE_URL and SUPABASE_ANON_KEY.');
  return { url: url.replace(/\/$/, ''), key };
}

async function main() {
  const reportKey = process.env.GROWTH_REPORT_KEY;
  if (!reportKey) throw new Error('GROWTH_REPORT_KEY is not set.');
  const out = process.argv[2] || 'report.md';
  const { url, key } = publicSettings();
  const res = await fetch(`${url}/rest/v1/rpc/growth_report`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_key: reportKey }),
  });
  if (!res.ok) {
    // The body is the server's short refusal ("not allowed", or "function not found" before the migration), never the key.
    throw new Error(`growth_report: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  fs.writeFileSync(out, `${formatReport(await res.json())}\n`);
  console.log(`Wrote ${out}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
