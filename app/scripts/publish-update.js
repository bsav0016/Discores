#!/usr/bin/env node
/**
 * Publishes an over-the-air update to a channel, after the same checks CI runs.
 *
 *   npm run update:preview                  # any clean branch, goes to the preview channel (internal builds)
 *   npm run update:production               # RELEASE_BRANCH only, exactly what is merged and pushed
 *   npm run update:preview -- --dry-run     # run every check, print the command, publish nothing
 *
 * Needs `npx eas-cli login` first (your Expo account). See ../docs/over-the-air-updates.md.
 */
const { execFileSync, spawnSync } = require('child_process');
const { planUpdate, CHANNELS } = require('./updatePlan');

// The branch production updates come from.
const RELEASE_BRANCH = 'main';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function tryGit(...args) {
  try {
    return git(...args);
  } catch {
    return null;
  }
}

// On Windows npm and npx are .cmd files that need a shell, and a shell splits unquoted arguments at spaces
// (the update message has spaces), so quote each argument there and hand the shell one command line.
function quote(arg) {
  return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

function run(command, args, env = {}) {
  const windows = process.platform === 'win32';
  const shown = windows ? args.map(quote) : args;
  console.log(`\n> ${command} ${shown.join(' ')}`);
  const options = { stdio: 'inherit', env: { ...process.env, ...env } };
  const result = windows
    ? spawnSync([command, ...shown].join(' '), { ...options, shell: true })
    : spawnSync(command, args, options);
  return result.status === 0;
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const channel = args.find((arg) => !arg.startsWith('--'));
  if (!CHANNELS.includes(channel)) {
    console.error(`Usage: publish-update.js <${CHANNELS.join('|')}> [--dry-run]`);
    process.exit(2);
  }

  if (channel === 'production') {
    tryGit('fetch', 'origin', RELEASE_BRANCH);
  }
  const plan = planUpdate({
    channel,
    branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
    releaseBranch: RELEASE_BRANCH,
    dirty: git('status', '--porcelain') !== '',
    head: git('rev-parse', 'HEAD'),
    originMain: tryGit('rev-parse', `origin/${RELEASE_BRANCH}`),
    subject: git('log', '-1', '--format=%s'),
    expoConfig: require('../app.json').expo,
    // The public Supabase values the store build gets come from eas.json, which `eas update` does not read.
    buildEnv: ((require('../eas.json').build || {})[channel] || {}).env || {},
  });

  if (plan.errors.length) {
    console.error('Not publishing:');
    plan.errors.forEach((error) => console.error(`  - ${error}`));
    process.exit(1);
  }

  console.log(`Channel: ${channel}   Runtime version: ${plan.runtimeVersion}`);
  const checks = [["run", "typecheck"], ["test", "--", "--ci"], ["run", "build:check"]];
  for (const check of checks) {
    if (!run(npm, check, plan.env)) {
      console.error(`\nNot publishing: "npm ${check.join(' ')}" failed.`);
      process.exit(1);
    }
  }

  if (dryRun) {
    console.log(`\nDry run: all checks passed. Would run:\n  npx ${plan.command.join(' ')}`);
    return;
  }
  if (!run(npx, plan.command, plan.env)) {
    console.error('\neas update failed. Nothing was published unless eas-cli said so above.');
    process.exit(1);
  }
}

main();
