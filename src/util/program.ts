/**
 * What this CLI is called, and how a document tells somebody to run it.
 *
 * Three bins point at the same file: `collab-swarm`, the package name; `swarm`,
 * the short one a developer types once it is installed; and the `cswarm` alias.
 * Which of them is correct depends on who is reading.
 *
 * It lives away from `cli.ts` because the generated instruction block needs it
 * too, and `cli.ts` imports every command, which imports the emitters — so
 * reaching back into it would close a cycle.
 */

import { basename } from 'node:path';

/** Every name this binary is installed under. */
export const BINS = ['collab-swarm', 'swarm', 'cswarm'];

/**
 * The name this binary was invoked as, for usage lines it prints itself.
 *
 * `collab-swarm` is the fallback because it is the package name, and so the
 * one that is always right when there is nothing to derive it from.
 */
export const PROGRAM: string = (() => {
  const invoked = process.argv[1];
  if (invoked === undefined) return BINS[0]!;
  const name = basename(invoked).replace(/\.[cm]?js$/, '');
  return BINS.includes(name) ? name : BINS[0]!;
})();

/**
 * How a command is written for a reader who may have nothing installed.
 *
 * Always the package name. `npx swarm` resolves an unrelated package on the
 * npm registry for anyone without a local install, so it is never what a
 * generated document prints — somebody who *has* installed it can still type
 * `swarm`, and nothing here tells them not to.
 */
export const INVOCATION = `npx ${BINS[0]}`;
