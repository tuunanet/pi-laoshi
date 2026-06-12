import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import YAML from "yaml";

export type ActivityKind = "lesson" | "exercise";

export interface ActivityFrontmatter {
  id: string;
  type: ActivityKind;
  title: string;
  level: string;
  target_vocab?: string[];
  estimated_minutes?: number;
}

export interface ActivityMetadata extends ActivityFrontmatter {
  path: string;
}

export interface LoadedActivity extends ActivityMetadata {
  body: string;
}

export function packageRootFromImportMeta(metaUrl: string): string {
  // src/content.ts -> package root in source tree, dist/src/content.js -> package root in built tree.
  const here = new URL(".", metaUrl).pathname;
  return here.endsWith("/dist/src/") ? resolve(here, "../..") : resolve(here, "..");
}

export function defaultContentDir(root = packageRootFromImportMeta(import.meta.url)): string {
  return join(root, "content");
}

export function parseMarkdownActivity(markdown: string, path = "<memory>"): LoadedActivity {
  const match = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/u.exec(markdown);
  if (!match) throw new Error(`Missing frontmatter in ${path}`);
  const data = YAML.parse(match[1]) as Partial<ActivityFrontmatter> | null;
  if (!data?.id || !data.type || !data.title || !data.level) {
    throw new Error(`Activity frontmatter in ${path} must include id, type, title, and level`);
  }
  if (data.type !== "lesson" && data.type !== "exercise") {
    throw new Error(`Activity ${data.id} has invalid type: ${String(data.type)}`);
  }
  return {
    id: data.id,
    type: data.type,
    title: data.title,
    level: data.level,
    target_vocab: data.target_vocab ?? [],
    estimated_minutes: data.estimated_minutes,
    path,
    body: match[2].trim(),
  };
}

async function collectMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await collectMarkdownFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(full);
  }
  return files;
}

export async function listActivities(contentDir = defaultContentDir()): Promise<ActivityMetadata[]> {
  const files = await collectMarkdownFiles(contentDir);
  const activities = await Promise.all(files.map(async (file) => parseMarkdownActivity(await readFile(file, "utf8"), file)));
  return activities
    .map(({ body: _body, ...metadata }) => metadata)
    .sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
}

export async function loadActivity(idOrTitle: string, contentDir = defaultContentDir()): Promise<LoadedActivity | null> {
  const needle = idOrTitle.trim().toLowerCase();
  const files = await collectMarkdownFiles(contentDir);
  for (const file of files) {
    const activity = parseMarkdownActivity(await readFile(file, "utf8"), file);
    if (activity.id.toLowerCase() === needle || activity.title.toLowerCase() === needle) return activity;
  }
  return null;
}
