#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function markdownFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(full);
  }
  return files.sort();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hasFrontmatterDescription(markdown) {
  return /^---\n[\s\S]*description:\s*.+[\s\S]*\n---\n/u.test(markdown);
}

function hasActivityFrontmatter(markdown) {
  return /^---\n[\s\S]*id:\s*.+[\s\S]*type:\s*(lesson|exercise)[\s\S]*title:\s*.+[\s\S]*level:\s*.+[\s\S]*\n---\n/u.test(markdown);
}

const pkg = JSON.parse(await readFile("package.json", "utf8"));
const resourcePaths = [
  ...pkg.pi.extensions,
  ...pkg.pi.skills,
  ...pkg.pi.prompts,
  ...pkg.files,
];

for (const resourcePath of resourcePaths) await stat(resourcePath);

for (const prompt of await markdownFiles("prompts")) {
  assert(hasFrontmatterDescription(await readFile(prompt, "utf8")), `Prompt missing description frontmatter: ${prompt}`);
}

for (const activity of await markdownFiles("content")) {
  assert(hasActivityFrontmatter(await readFile(activity, "utf8")), `Activity missing required frontmatter: ${activity}`);
}

const { stdout } = await execFileAsync("npm", ["pack", "--dry-run", "--json"], { timeout: 30_000 });
const pack = JSON.parse(stdout)[0];
const packedFiles = new Set(pack.files.map((file) => file.path));

const requiredPackedFiles = [
  "package.json",
  "README.md",
  "LICENSE",
  "extensions/laoshi/index.ts",
  "skills/chinese-teacher/SKILL.md",
  "prompts/laoshi-sync.md",
  "content/lessons/greetings-1.md",
  "src/db.ts",
  "src/backup.ts",
  "src/sync.ts",
  "src/evaluation.ts",
  "src/simplified.ts",
  "scripts/smoke-package.mjs",
];

for (const file of requiredPackedFiles) {
  assert(packedFiles.has(file), `Packed package missing required file: ${file}`);
}

for (const forbidden of ["coverage/", "node_modules/", "tests/"]) {
  assert(![...packedFiles].some((file) => file.startsWith(forbidden)), `Packed package includes forbidden path: ${forbidden}`);
}

console.log(`pi-laoshi package smoke passed (${pack.files.length} packed files checked)`);
