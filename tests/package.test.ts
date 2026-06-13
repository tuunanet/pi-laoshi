import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMarkdownActivity } from "../src/content.js";

const execFileAsync = promisify(execFile);

async function markdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(full);
  }
  return files.sort();
}

describe("pi package resources", () => {
  it("declares existing Pi resource paths and release smoke script", async () => {
    const pkg = JSON.parse(await readFile("package.json", "utf8")) as { pi: Record<string, string[]>; files: string[]; scripts: Record<string, string> };
    expect(pkg.pi.extensions).toEqual(["./extensions"]);
    expect(pkg.pi.skills).toEqual(["./skills"]);
    expect(pkg.pi.prompts).toEqual(["./prompts"]);
    expect(pkg.scripts.smoke).toBe("node scripts/smoke-package.mjs");
    for (const resourcePath of [...pkg.pi.extensions, ...pkg.pi.skills, ...pkg.pi.prompts, ...pkg.files, "scripts/smoke-package.mjs"]) {
      await expect(stat(resourcePath)).resolves.toBeTruthy();
    }
  });

  it("keeps prompt templates documented with frontmatter descriptions", async () => {
    for (const file of await markdownFiles("prompts")) {
      const markdown = await readFile(file, "utf8");
      expect(markdown, file).toMatch(/^---\n[\s\S]*description:\s*.+[\s\S]*\n---\n/u);
    }
  });

  it("parses every bundled lesson and exercise", async () => {
    for (const file of await markdownFiles("content")) {
      const activity = parseMarkdownActivity(await readFile(file, "utf8"), file);
      expect(activity.id, file).toBeTruthy();
      expect(activity.body, file).toContain("##");
    }
  });

  it("runs the release smoke script", async () => {
    const { stdout } = await execFileAsync("npm", ["run", "smoke"], { timeout: 30_000 });
    expect(stdout).toContain("pi-laoshi package smoke passed");
  });
});
