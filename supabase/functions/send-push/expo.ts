// Expo's push service: https://docs.expo.dev/push-notifications/sending-notifications/
// One request takes up to 100 messages and answers with one "ticket" per message, in the same order.
import type { PushMessage } from './message.ts';

export const EXPO_URL = 'https://exp.host/--/api/v2/push/send';
export const BATCH_SIZE = 100;

export type Ticket = { status: 'ok' } | { status: 'error'; message?: string; details?: { error?: string } };

/** Expo could not be reached or did not give a usable answer: the messages were not accepted and can be retried. */
export class ExpoUnavailable extends Error {}

export function chunk<T>(items: T[], size = BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** True when Expo says this phone token is dead (app uninstalled, or the token was revoked). */
export function isDeadToken(ticket: Ticket): boolean {
  return ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered';
}

export async function sendBatch(
  messages: PushMessage[],
  opts: { fetchFn?: typeof fetch; accessToken?: string } = {},
): Promise<Ticket[]> {
  if (messages.length === 0) return [];
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (opts.accessToken) headers.Authorization = `Bearer ${opts.accessToken}`;
  let res: Response;
  try {
    res = await (opts.fetchFn ?? fetch)(EXPO_URL, {
      method: 'POST', headers, body: JSON.stringify(messages), signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    throw new ExpoUnavailable(`request failed: ${(e as Error).message}`);
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new ExpoUnavailable(`Expo answered ${res.status}`);
  }
  let json: { data?: unknown };
  try {
    json = await res.json();
  } catch {
    throw new ExpoUnavailable('Expo sent an unreadable answer');
  }
  if (!Array.isArray(json.data) || json.data.length !== messages.length) {
    throw new ExpoUnavailable('Expo sent the wrong number of tickets');
  }
  return json.data as Ticket[];
}
