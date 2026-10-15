/** The server accepts display names of 1 to 40 characters. */
export const MAX_DISPLAY_NAME = 40;

/** What someone is called when they leave the name blank at sign-up: the part of their email before the @. */
export function defaultDisplayName(email: string): string {
  const local = email.split('@')[0].trim();
  return (local || 'Player').slice(0, MAX_DISPLAY_NAME);
}

/** A name that can be saved, or a message to show. Stray spaces are tidied. */
export function checkDisplayName(input: string): { name: string } | { error: string } {
  const name = input.replace(/\s+/g, ' ').trim();
  if (!name) return { error: 'Enter a name.' };
  if (name.length > MAX_DISPLAY_NAME) return { error: `Use ${MAX_DISPLAY_NAME} characters or fewer.` };
  return { name };
}
