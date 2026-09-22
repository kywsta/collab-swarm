/**
 * Materialises the workflow into a repository.
 *
 * Skills, rules and workflow documents are vendored so the repository stays
 * self-contained and works in sandboxes with no `node_modules`. A manifest
 * records what was written, so the next sync can tell a file the project
 * edited (drift, left alone) from one an earlier version wrote (stale, removed).
 */

import { dirname, join } from 'node:path';
import type { Config } from './config.js';
import { loadPacks, readPackFile, type PackSet } from './packs.js';
import {
  digest,
  exists,
  listFiles,
  pruneEmptyDirs,
  readTextOrNull,
  remove,
  writeText,
} from './util/fs.js';
import { mergeBlock, renderMemoryBlock } from './targets/memory.js';
import { resolveTargets, type EmitContext, type Emission, type Target } from './targets/index.js';

export const MANIFEST_PATH = '.collab-swarm/manifest.json';
export type Action = 'create' | 'update' | 'unchanged' | 'kept' | 'drift';

export interface PlannedFile {
  path: string;
  content: string;
  mode: Emission['mode'];
  action: Action;
}

export interface SyncPlan {
  files: PlannedFile[];
  /** Files an earlier sync wrote that this one no longer emits. */
  stale: string[];
  targets: Target[];
  packs: PackSet;
}

interface Manifest {
  version: string;
  generatedAt: string;
  targets: string[];
  packs: string[];
  files: Record<string, string>;
}

const readManifest = (root: string): Manifest | null => {
  const text = readTextOrNull(join(root, MANIFEST_PATH));
  if (text === null) return null;
  try {
    return JSON.parse(text) as Manifest;
  } catch {
    return null;
  }
};

/** Every file of the workflow documents shipped by the core pack. */
function workflowDocuments(packs: PackSet): Map<string, string> {
  const core = packs.packs.find((pack) => pack.core);
  const documents = new Map<string, string>();
  if (!core) return documents;
  const root = join(core.dir, 'workflow');
  for (const file of listFiles(root)) {
    const content = readTextOrNull(join(root, file));
    if (content !== null) documents.set(file, content);
  }
  return documents;
}

/**
 * Every file of every skill, as emissions under one skill root.
 *
 * Bodies are read through the pack's answers, so a project that chose one push
 * provider never has the other one's prose published into its agent files.
 */
function skillPayload(packs: PackSet, skillRoot: string): Emission[] {
  const emissions: Emission[] = [];
  for (const skill of packs.skills) {
    for (const file of listFiles(skill.dir)) {
      const content = readPackFile(skill, join(skill.dir, file));
      if (content === null) continue;
      emissions.push({ path: `${skillRoot}/${skill.name}/${file}`, content, mode: 'managed' });
    }
  }
  return emissions;
}

export function buildContext(root: string, config: Config, version: string): EmitContext {
  const packs = loadPacks(root, config.packs, config.packOptions);
  return {
    config,
    packs,
    root,
    workflow: workflowDocuments(packs),
    skills: [...packs.skills].sort((a, b) => a.name.localeCompare(b.name)),
    rules: [...packs.rules].sort((a, b) => a.file.localeCompare(b.file)),
    version,
  };
}

export function planSync(root: string, config: Config, version: string): SyncPlan {
  const targets = resolveTargets(config.targets);
  const context = buildContext(root, config, version);

  const emissions: Emission[] = [];
  const seenSkillRoots = new Set<string>();
  for (const target of targets) {
    if (target.skillRoot && !seenSkillRoots.has(target.skillRoot)) {
      seenSkillRoots.add(target.skillRoot);
      emissions.push(...skillPayload(context.packs, target.skillRoot));
    }
    emissions.push(...target.emit(context));
  }

  // One path may be emitted by several targets. The last emission wins for
  // ordinary files; a `block` emission merges into whatever is already there.
  const byPath = new Map<string, Emission>();
  for (const emission of emissions) {
    if (emission.mode === 'block') {
      const existing = byPath.get(emission.path);
      // Two targets sharing a memory file (AGENTS.md) render the same block.
      if (existing?.mode === 'block') continue;
    }
    byPath.set(emission.path, emission);
  }

  const manifest = readManifest(root);
  const files: PlannedFile[] = [];

  for (const emission of [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path))) {
    const absolute = join(root, emission.path);
    const current = readTextOrNull(absolute);

    if (emission.mode === 'seed') {
      files.push({
        ...emission,
        action: current === null ? 'create' : 'kept',
      });
      continue;
    }

    const desired =
      emission.mode === 'block'
        ? mergeBlock(current, emission.content, config.project)
        : emission.content;

    if (current === null) {
      files.push({ ...emission, content: desired, action: 'create' });
      continue;
    }
    if (current === desired) {
      files.push({ ...emission, content: desired, action: 'unchanged' });
      continue;
    }
    // A managed file the project edited by hand: report rather than clobber.
    const recorded = manifest?.files[emission.path];
    const edited = emission.mode === 'managed' && recorded !== undefined && recorded !== digest(current);
    files.push({ ...emission, content: desired, action: edited ? 'drift' : 'update' });
  }

  const emitted = new Set(byPath.keys());
  const stale = Object.keys(manifest?.files ?? {})
    .filter((path) => !emitted.has(path))
    .filter((path) => exists(join(root, path)))
    .sort();

  return { files, stale, targets, packs: context.packs };
}

export interface ApplyResult {
  written: string[];
  kept: string[];
  drifted: string[];
  removed: string[];
}

export function applySync(
  root: string,
  plan: SyncPlan,
  config: Config,
  version: string,
  options: { force?: boolean; pruneStale?: boolean } = {},
): ApplyResult {
  const result: ApplyResult = { written: [], kept: [], drifted: [], removed: [] };
  const manifestFiles: Record<string, string> = {};

  for (const file of plan.files) {
    const absolute = join(root, file.path);

    if (file.action === 'drift' && !options.force) {
      result.drifted.push(file.path);
      const current = readTextOrNull(absolute);
      if (current !== null) manifestFiles[file.path] = digest(current);
      continue;
    }
    if (file.action === 'kept') {
      result.kept.push(file.path);
      continue;
    }
    if (file.action === 'unchanged') {
      manifestFiles[file.path] = digest(file.content);
      continue;
    }

    writeText(absolute, file.content);
    manifestFiles[file.path] = digest(file.content);
    result.written.push(file.path);
  }

  if (options.pruneStale !== false) {
    for (const path of plan.stale) {
      const absolute = join(root, path);
      remove(absolute);
      // A directory an earlier version created has no reason to linger empty.
      pruneEmptyDirs(dirname(absolute), root);
      result.removed.push(path);
    }
  } else {
    for (const path of plan.stale) {
      const current = readTextOrNull(join(root, path));
      if (current !== null) manifestFiles[path] = digest(current);
    }
  }

  const manifest: Manifest = {
    version,
    generatedAt: new Date().toISOString().replace(/\.\d+/, ''),
    targets: config.targets,
    packs: config.packs,
    files: Object.fromEntries(Object.entries(manifestFiles).sort(([a], [b]) => a.localeCompare(b))),
  };
  writeText(join(root, MANIFEST_PATH), `${JSON.stringify(manifest, null, 2)}\n`);
  return result;
}
