import { parse, stringify } from 'yaml';

export type Dict = Record<string, unknown>;

export const parseYaml = (text: string): unknown => parse(text);

export const toYaml = (value: unknown): string => stringify(value, { lineWidth: 0 });

export interface FrontMatter {
  data: Dict;
  body: string;
}

/**
 * Reads `---` delimited YAML front matter. Returns null when the file has none
 * or the block is never closed, so callers can report the two cases apart from
 * a genuine parse error.
 */
export function readFrontMatter(text: string): FrontMatter | null {
  const normalized = text.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return null;
  const end = normalized.indexOf('\n---', 3);
  if (end < 0) return null;
  const afterFence = normalized.indexOf('\n', end + 1);
  const parsed = parse(normalized.slice(4, end + 1)) as unknown;
  if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed))) return null;
  return {
    data: (parsed ?? {}) as Dict,
    body: afterFence < 0 ? '' : normalized.slice(afterFence + 1),
  };
}

export function writeFrontMatter(data: Dict, body: string): string {
  return `---\n${toYaml(data).trimEnd()}\n---\n\n${body.replace(/^\n+/, '')}`;
}

export const asDict = (value: unknown): Dict | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Dict) : null;

export const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

export const asStringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

export const isSlug = (value: string) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);

export const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
