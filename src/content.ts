import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { defaultCustomContentDir } from "./paths.js";
import { toSimplifiedChinese } from "./simplified.js";

export type ActivityKind = "lesson" | "exercise";
export type ActivityOrigin = "package" | "custom";

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
  origin: ActivityOrigin;
  editable: boolean;
}

export interface LoadedActivity extends ActivityMetadata {
  body: string;
}

export interface ContentSource {
  dir: string;
  origin: ActivityOrigin;
  editable: boolean;
}

export interface ActivitySaveInput extends ActivityFrontmatter {
  body: string;
}

export function packageRootFromImportMeta(metaUrl: string): string {
  // src/content.ts -> package root in source tree, dist/src/content.js -> package root in built tree.
  const here = new URL(".", metaUrl).pathname;
  return here.endsWith("/dist/src/") ? resolve(here, "../..") : resolve(here, "..");
}

export function defaultPackageContentDir(root = packageRootFromImportMeta(import.meta.url)): string {
  return join(root, "content");
}

// Backward-compatible alias for existing callers/tests.
export function defaultContentDir(root = packageRootFromImportMeta(import.meta.url)): string {
  return defaultPackageContentDir(root);
}

export function defaultContentSources(): ContentSource[] {
  return [
    { dir: defaultCustomContentDir(), origin: "custom", editable: true },
    { dir: defaultPackageContentDir(), origin: "package", editable: false },
  ];
}

export function validateActivityId(id: string): string {
  const normalized = id.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/u.test(normalized) || normalized.includes("--")) {
    throw new Error("Activity id must be 3-64 lowercase letters, numbers, or single hyphens");
  }
  return normalized;
}

export function parseMarkdownActivity(
  markdown: string,
  path = "<memory>",
  origin: ActivityOrigin = "package",
  editable = origin === "custom",
): LoadedActivity {
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
    id: validateActivityId(data.id),
    type: data.type,
    title: data.title,
    level: data.level,
    target_vocab: (data.target_vocab ?? []).map(toSimplifiedChinese),
    estimated_minutes: data.estimated_minutes,
    path,
    origin,
    editable,
    body: toSimplifiedChinese(match[2].trim()),
  };
}

async function collectMarkdownFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await collectMarkdownFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(full);
  }
  return files;
}

function normalizeSources(content: string | ContentSource[] = defaultContentSources()): ContentSource[] {
  if (typeof content === "string") return [{ dir: content, origin: "package", editable: false }];
  return content;
}

export async function listActivities(content: string | ContentSource[] = defaultContentSources()): Promise<ActivityMetadata[]> {
  const sources = normalizeSources(content);
  const activities: ActivityMetadata[] = [];
  for (const source of sources) {
    const files = await collectMarkdownFiles(source.dir);
    for (const file of files) {
      const { body: _body, ...metadata } = parseMarkdownActivity(await readFile(file, "utf8"), file, source.origin, source.editable);
      activities.push(metadata);
    }
  }
  return activities.sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id) || a.origin.localeCompare(b.origin));
}

export async function loadActivity(idOrTitle: string, content: string | ContentSource[] = defaultContentSources()): Promise<LoadedActivity | null> {
  const needle = idOrTitle.trim().toLowerCase();
  const sources = normalizeSources(content);
  for (const source of sources) {
    const files = await collectMarkdownFiles(source.dir);
    for (const file of files) {
      const activity = parseMarkdownActivity(await readFile(file, "utf8"), file, source.origin, source.editable);
      if (activity.id.toLowerCase() === needle || activity.title.toLowerCase() === needle) return activity;
    }
  }
  return null;
}

function markdownForActivity(input: ActivitySaveInput): string {
  const frontmatter: ActivityFrontmatter = {
    id: validateActivityId(input.id),
    type: input.type,
    title: input.title,
    level: input.level,
    target_vocab: (input.target_vocab ?? []).map(toSimplifiedChinese),
    estimated_minutes: input.estimated_minutes,
  };
  return `---\n${YAML.stringify(frontmatter).trim()}\n---\n\n${toSimplifiedChinese(input.body.trim())}\n`;
}

export async function saveCustomActivity(
  input: ActivitySaveInput,
  options: { overwrite?: boolean; customContentDir?: string } = {},
): Promise<LoadedActivity> {
  const id = validateActivityId(input.id);
  const typeDir = input.type === "lesson" ? "lessons" : "exercises";
  const dir = join(options.customContentDir ?? defaultCustomContentDir(), typeDir);
  const file = join(dir, `${id}.md`);

  if (!options.overwrite) {
    try {
      await access(file);
      throw new Error(`Custom activity already exists: ${id}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  await mkdir(dir, { recursive: true });
  await writeFile(file, markdownForActivity({ ...input, id }), "utf8");
  return parseMarkdownActivity(await readFile(file, "utf8"), file, "custom", true);
}
