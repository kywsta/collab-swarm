/**
 * Glob matching for the path patterns rules and sources are written with.
 *
 * Deliberately small: `**` across directories, `*` and `?` within one segment.
 * That is the subset every target's own matcher agrees on — Cursor joins the
 * same patterns into its `globs:` field, and a rule that needed brace expansion
 * would mean something different to each tool reading it.
 */

const SPECIAL = /[.+^${}()|[\]\\]/g;

function toRegExp(pattern: string): RegExp {
  let source = '';
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index]!;
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        index++;
        // `**/` spans zero or more directories; a trailing `**` spans the rest.
        if (pattern[index + 1] === '/') {
          index++;
          source += '(?:[^/]*/)*';
        } else {
          source += '.*';
        }
        continue;
      }
      source += '[^/]*';
      continue;
    }
    source += char === '?' ? '[^/]' : char.replace(SPECIAL, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

const compiled = new Map<string, RegExp>();

export function matchesGlob(path: string, pattern: string): boolean {
  let regexp = compiled.get(pattern);
  if (!regexp) {
    regexp = toRegExp(pattern);
    compiled.set(pattern, regexp);
  }
  return regexp.test(path.replace(/^\.\//, ''));
}

/** The first pattern that covers `path`, or null when none does. */
export const firstMatch = (path: string, patterns: string[]): string | null =>
  patterns.find((pattern) => matchesGlob(path, pattern)) ?? null;
