import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

export const exists = (path: string) => existsSync(path);

export const readText = (path: string) => readFileSync(path, 'utf8');

export const readTextOrNull = (path: string): string | null =>
  existsSync(path) && statSync(path).isFile() ? readFileSync(path, 'utf8') : null;

export function writeText(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

export const remove = (path: string) => rmSync(path, { recursive: true, force: true });

/** Every file under `root`, as POSIX paths relative to it, sorted. */
export function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) found.push(relative(root, full).split(sep).join('/'));
    }
  };
  walk(root);
  return found.sort();
}

export const listDirs = (root: string): string[] =>
  existsSync(root)
    ? readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    : [];

export const digest = (content: string | Buffer) =>
  createHash('sha256').update(content).digest('hex').slice(0, 16);

/** Removes `dir` and every now-empty ancestor up to (but not including) `stopAt`. */
export function pruneEmptyDirs(dir: string, stopAt: string): void {
  let current = dir;
  while (current.startsWith(stopAt) && current !== stopAt) {
    if (!existsSync(current) || readdirSync(current).length > 0) return;
    rmSync(current, { recursive: true, force: true });
    current = dirname(current);
  }
}
