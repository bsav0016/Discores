// First-party error reporting. One small row per failure goes to log_client_event() (migration 0026): a kind, a
// short code, a scrubbed message, the app version and the platform. No account id, device id or round data.
//
// Rules this file keeps:
//   * reporting must never throw, never wait for anything the app needs, and never report its own failures;
//   * only signed-in people report (the server refuses anyone else; guests send nothing);
//   * a repeat of the same failure is sent once per run, and a run sends at most 10 events;
//   * if the server says it is limiting us, or the function does not exist yet, reporting stops for the run.
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { cleanCode, scrubMessage } from './scrub';

export type EventKind = 'error' | 'crash' | 'sync';
export type EventPayload = {
  p_kind: EventKind; p_code: string; p_message: string; p_app_version: string; p_platform: 'ios' | 'android';
};

export type ReporterDeps = {
  /** Calls log_client_event(). Resolves with its answer or an error. */
  send: (payload: EventPayload) => Promise<{ data: unknown; error: unknown | null }>;
  isSignedIn: () => Promise<boolean>;
  platform: string;
  version: string;
  maxPerRun?: number;
};

export function createReporter(deps: ReporterDeps) {
  const maxPerRun = deps.maxPerRun ?? 10;
  const seen = new Set<string>();
  let sent = 0;
  let stopped = false;

  return async function report(kind: EventKind, code: string, error?: unknown): Promise<void> {
    try {
      if (stopped || sent >= maxPerRun) return;
      if (deps.platform !== 'ios' && deps.platform !== 'android') return;
      const payload: EventPayload = {
        p_kind: kind,
        p_code: cleanCode(code),
        p_message: error === undefined ? '' : scrubMessage(error),
        p_app_version: deps.version.slice(0, 20),
        p_platform: deps.platform,
      };
      const key = `${payload.p_kind}|${payload.p_code}|${payload.p_message}`;
      if (seen.has(key)) return;
      seen.add(key);
      sent++; // counted before sending, so a slow or failing server cannot let a crash loop flood it
      if (!(await deps.isSignedIn())) return;
      const { data, error: failure } = await deps.send(payload);
      // Not deployed yet, or the person is over the hourly limit: stay quiet for the rest of the run.
      if (failure || data === 'limited' || data === 'invalid') stopped = true;
    } catch {
      stopped = true;
    }
  };
}

let reporter: ReturnType<typeof createReporter> | null = null;

/** Reports a failure. Safe to call from anywhere, including catch blocks and the crash handler. */
export function report(kind: EventKind, code: string, error?: unknown): void {
  try {
    if (!reporter) {
      // Loaded on first use so the Supabase client is not created just by importing this file.
      const { supabase } = require('./supabase') as typeof import('./supabase');
      reporter = createReporter({
        send: async (payload) => {
          const { data, error: e } = await supabase.rpc('log_client_event', payload);
          return { data, error: e };
        },
        isSignedIn: async () => !!(await supabase.auth.getSession()).data.session,
        platform: Platform.OS,
        version: Constants.expoConfig?.version ?? '',
      });
    }
    void reporter(kind, code, error);
  } catch {
    // Never let reporting break the app.
  }
}

/** Reports a server refusal (an error with a code) but not a plain network failure, which is just being offline. */
export function reportRpcFailure(code: string, error: unknown): void {
  const c = (error as { code?: unknown } | null)?.code;
  if (typeof c === 'string' && c.length > 0) report('error', code, error);
}

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;

/** Reports uncaught JavaScript errors, then hands them on to React Native's own handler (red box or crash). */
export function installGlobalErrorHandler(): void {
  const utils = (globalThis as { ErrorUtils?: { getGlobalHandler(): GlobalHandler; setGlobalHandler(h: GlobalHandler): void } }).ErrorUtils;
  if (!utils) return;
  const previous = utils.getGlobalHandler();
  utils.setGlobalHandler((error, isFatal) => {
    report('crash', isFatal ? 'js.fatal' : 'js.uncaught', error);
    previous(error, isFatal);
  });
}
