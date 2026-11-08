// Cleans an error message before it can leave the phone. The rule is to keep what helps fix a bug (the kind of
// failure) and drop anything that could be a person: emails, ids, tokens, links, file paths and long numbers.
// Everything is replaced by a fixed placeholder, so a scrubbed message never contains a fragment of the original.

export const MAX_MESSAGE = 200;
const LIMIT = 1000;

const RULES: [RegExp, string][] = [
  [/eyJ[\w-]{5,}\.[\w-]{5,}(?:\.[\w-]*)?/g, '[token]'], // JWTs
  [/Expo(?:nent)?PushToken\[[^\]]*\]/gi, '[token]'],
  [/[\w.+'-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]'],
  [/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[url]'], // https://, discores://, file://
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]'],
  [/(^|[\s(])(?:\/[^\s)]+|[A-Za-z]:\\[^\s)]*)/g, '$1[path]'], // /data/user/0/... and C:\...
  [/\b(?=[\w-]*[A-Z0-9])[\w-]{24,}\b/g, '[secret]'], // long strings with a digit or capital: keys, hashes (plain snake_case names stay)
  [/\d{5,}/g, '[n]'], // phone numbers, ids, timestamps
  [/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '[ip]'],
];

/** A short message that is safe to send. Never throws; anything that is not text becomes an empty message. */
export function scrubMessage(input: unknown): string {
  let text = '';
  try {
    if (typeof input === 'string') text = input;
    else if (input instanceof Error) text = input.message;
    else if (input && typeof input === 'object') text = String((input as { message?: unknown }).message ?? '');
    else if (input !== null && input !== undefined) text = String(input);
  } catch {
    return '';
  }
  // Cut first so a huge message cannot make the rules slow. The cut can split a word (an email, say) in two, and
  // the rules would then miss the half, so the unfinished last word is dropped.
  if (text.length > LIMIT) text = text.slice(0, LIMIT).replace(/\S*$/, '');
  for (const [rule, replacement] of RULES) text = text.replace(rule, replacement);
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE);
}

/** A code the server accepts (`[a-z0-9_.:-]{1,64}`): lower case, anything else turned into an underscore. */
export function cleanCode(code: string): string {
  const c = code.toLowerCase().replace(/[^a-z0-9_.:-]+/g, '_').slice(0, 64);
  return c || 'unknown';
}
