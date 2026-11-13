/**
 * Decides whether an over-the-air update may be published, and with what command. Pure: it gets facts about the
 * repository as plain values and does no I/O, so every rule can be tested (see the updatePlan test).
 * scripts/publish-update.js gathers the facts, runs the checks and executes the plan.
 */
const CHANNELS = ['preview', 'production'];

/**
 * @param {object} facts
 * @param {string} facts.channel         'preview' or 'production'
 * @param {string} facts.branch          current git branch
 * @param {string} facts.releaseBranch   the branch production updates are published from (the repo's default branch)
 * @param {boolean} facts.dirty          uncommitted or untracked changes exist
 * @param {string} facts.head            full commit hash of HEAD
 * @param {string|null} facts.originMain full commit hash of origin/<releaseBranch>, or null if unknown
 * @param {string} facts.subject         HEAD's commit subject line
 * @param {object} facts.expoConfig      the `expo` object from app.json
 * @param {object} [facts.buildEnv]      the `env` block of this channel's build profile in eas.json
 * @returns {{ errors: string[], command: string[]|null, runtimeVersion: string|null, env: object }}
 *   `env` is the build profile's environment (the public Supabase address and key live in eas.json, not in an EAS
 *   environment), added to every command so an update is bundled with the same values as a store build.
 */
function planUpdate(facts) {
  const errors = [];
  const { channel, branch, releaseBranch, dirty, head, originMain, subject, expoConfig, buildEnv } = facts;

  if (!CHANNELS.includes(channel)) {
    errors.push(`Channel must be one of: ${CHANNELS.join(', ')} (got "${channel}").`);
  }
  if (dirty) {
    errors.push('The working tree has uncommitted changes. Commit or stash them so the update matches a commit.');
  }
  if (channel === 'production') {
    if (branch !== releaseBranch) {
      errors.push(`Production updates are published from ${releaseBranch} (you are on "${branch}"). Publish to preview to try a branch.`);
    }
    if (!originMain) {
      errors.push(`Could not read origin/${releaseBranch}. Run \`git fetch\` and try again.`);
    } else if (head !== originMain) {
      errors.push(`HEAD is not the same as origin/${releaseBranch}. Pull (or push) so production gets exactly what is merged.`);
    }
  }

  const updates = expoConfig && expoConfig.updates;
  const runtimeVersion = expoConfig && expoConfig.runtimeVersion;
  if (!updates || !updates.url || !runtimeVersion) {
    errors.push('app.json has no updates.url / runtimeVersion, so builds could not receive this update.');
  }

  const command = errors.length
    ? null
    : [
        'eas-cli', 'update',
        '--channel', channel,
        '--environment', channel,
        '--message', `${head.slice(0, 7)} ${subject}`.trim(),
        '--non-interactive',
      ];
  return { errors, command, runtimeVersion: runtimeVersion ? JSON.stringify(runtimeVersion) : null, env: { ...(buildEnv || {}) } };
}

module.exports = { planUpdate, CHANNELS };
