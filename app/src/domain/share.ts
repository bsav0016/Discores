// The words people send when they share Discores. Pure, so they are tested rather than left to a screen.
//
// Every message links the public site, which has the store buttons for both phones: a person without the app cannot
// open a discores:// link, so the site is the link anyone can use. Messages carry only what the sender chose to share:
// their own score and the course, never other players' names or scores.
import { formatRelative } from './scoring';

export const SITE_URL = 'https://bsav0016.github.io/Discores/';

/** The sender's own result in a round, as a sentence they can post or send. */
export function roundShareMessage(r: {
  courseName: string;
  total: number;
  relative: number;
  holesPlayed: number;
  holeCount: number;
}): string {
  const score = `${r.total} (${formatRelative(r.relative)})`;
  const result = r.holesPlayed >= r.holeCount
    ? `I shot ${score} at ${r.courseName}`
    : `I'm ${score} through ${r.holesPlayed} holes at ${r.courseName}`;
  return `${result} on Discores, a free disc golf scorecard that works offline with no ads.\n${SITE_URL}`;
}

/**
 * Asking people to play with you. With a friend code the person can add you straight after installing; the
 * discores:// link opens the invite screen for someone who already has the app.
 */
export function inviteMessage(code: string | null, appLink: string | null): string {
  const intro = 'Play disc golf with me on Discores, a free scorecard that works offline with no ads.';
  if (!code) return `${intro}\nGet it: ${SITE_URL}`;
  return `${intro}\nGet it: ${SITE_URL}\nThen add my friend code: ${code}${appLink ? `\nAlready have it? ${appLink}` : ''}`;
}
