import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  defaultContentDir,
  defaultContentSources,
  listActivities,
  loadActivity,
  packageRootFromImportMeta,
  parseMarkdownActivity,
  saveCustomActivity,
  validateActivityId,
} from "../src/content.js";

const sample = `---
id: sample-lesson
type: lesson
title: Sample Lesson
level: beginner
target_vocab:
  - 你好
estimated_minutes: 5
---

## Objective

Practice greetings.
`;

describe("content activities", () => {
  it("resolves package roots and default content sources", () => {
    expect(packageRootFromImportMeta("file:///pkg/src/content.ts")).toBe("/pkg");
    expect(packageRootFromImportMeta("file:///pkg/dist/src/content.js")).toBe("/pkg");
    expect(defaultContentDir("/pkg")).toBe("/pkg/content");
    expect(defaultContentSources().map((source) => source.origin)).toEqual(["custom", "package"]);
  });

  it("validates activity ids", () => {
    expect(validateActivityId(" Greetings-2 ")).toBe("greetings-2");
    expect(() => validateActivityId("a")).toThrow(/Activity id/);
    expect(() => validateActivityId("bad--id")).toThrow(/Activity id/);
  });
  it("parses markdown frontmatter", () => {
    const minimal = parseMarkdownActivity("---\nid: minimal-lesson\ntype: lesson\ntitle: Minimal\nlevel: beginner\n---\nBody");
    expect(minimal.target_vocab).toEqual([]);
    expect(minimal.editable).toBe(false);
    const activity = parseMarkdownActivity(sample);
    expect(activity.id).toBe("sample-lesson");
    expect(activity.type).toBe("lesson");
    expect(activity.origin).toBe("package");
    expect(activity.editable).toBe(false);
    expect(activity.target_vocab).toEqual(["你好"]);
    expect(activity.body).toContain("Practice greetings");
  });

  it("rejects invalid markdown activities", () => {
    expect(() => parseMarkdownActivity("no frontmatter", "bad.md")).toThrow(/Missing frontmatter/);
    expect(() => parseMarkdownActivity("---\nid: missing\n---\n", "bad.md")).toThrow(/must include/);
    expect(() => parseMarkdownActivity("---\nid: bad-type\ntype: quiz\ntitle: Bad\nlevel: beginner\n---\n", "bad.md")).toThrow(/invalid type/);
  });

  it("discovers bundled activities", async () => {
    const activities = await listActivities();
    expect(activities.some((activity) => activity.id === "greetings-1")).toBe(true);

    const tempDir = await mkdtemp(join(tmpdir(), "pi-laoshi-sort-"));
    try {
      await saveCustomActivity({ id: "same-id", type: "lesson", title: "A", level: "beginner", body: "A" }, { customContentDir: tempDir });
      const packageDir = await mkdtemp(join(tmpdir(), "pi-laoshi-sort-pkg-"));
      try {
        await saveCustomActivity({ id: "same-id", type: "lesson", title: "B", level: "beginner", body: "B" }, { customContentDir: packageDir });
        const sorted = await listActivities([
          { dir: tempDir, origin: "custom", editable: true },
          { dir: packageDir, origin: "package", editable: false },
        ]);
        expect(sorted.map((activity) => activity.origin)).toEqual(["custom", "package"]);
      } finally {
        await rm(packageDir, { recursive: true, force: true });
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("loads an activity by id", async () => {
    const activity = await loadActivity("greetings-1");
    expect(activity?.title).toBe("Greetings 1");
    expect(activity?.body).toContain("你好");
    await expect(listActivities(join(tmpdir(), "missing-pi-laoshi-content"))).resolves.toEqual([]);
    await expect(loadActivity("missing", join(tmpdir(), "missing-pi-laoshi-content"))).resolves.toBeNull();
    const filePath = join(tmpdir(), `pi-laoshi-content-file-${process.pid}`);
    await writeFile(filePath, "not a directory");
    try {
      await expect(listActivities(filePath)).rejects.toThrow();
    } finally {
      await rm(filePath, { force: true });
    }
  });

  it("creates and loads custom activities", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "pi-laoshi-content-"));
    try {
      const saved = await saveCustomActivity(
        {
          id: "custom-greetings",
          type: "lesson",
          title: "Custom Greetings",
          level: "beginner",
          target_vocab: ["你好"],
          estimated_minutes: 10,
          body: "## Objective\n\nPractice a custom greeting.",
        },
        { customContentDir: tempDir },
      );
      expect(saved.origin).toBe("custom");
      expect(saved.editable).toBe(true);

      const sources = [{ dir: tempDir, origin: "custom" as const, editable: true }];
      const activities = await listActivities(sources);
      expect(activities.map((activity) => activity.id)).toContain("custom-greetings");

      const loaded = await loadActivity("Custom Greetings", sources);
      expect(loaded?.body).toContain("custom greeting");
      await expect(saveCustomActivity({ ...saved, body: "duplicate" }, { customContentDir: tempDir })).rejects.toThrow(/already exists/);
      const updated = await saveCustomActivity({ ...saved, type: "exercise", body: "## Objective\n\nUpdated." }, { customContentDir: tempDir, overwrite: true });
      expect(updated.path.endsWith("content.test.ts")).toBe(false);
      expect(updated.type).toBe("exercise");

      const traditional = await saveCustomActivity(
        {
          id: "traditional-source",
          type: "lesson",
          title: "Traditional Source",
          level: "beginner",
          target_vocab: ["老師", "學習"],
          body: "## Objective\n\n老師說謝謝。",
        },
        { customContentDir: tempDir },
      );
      expect(traditional.target_vocab).toEqual(["老师", "学习"]);
      expect(traditional.body).toContain("老师说谢谢");

      const oldStateDir = process.env.PI_LAOSHI_STATE_DIR;
      process.env.PI_LAOSHI_STATE_DIR = tempDir;
      try {
        const defaultSaved = await saveCustomActivity({
          id: "default-dir-exercise",
          type: "exercise",
          title: "Default Dir Exercise",
          level: "beginner",
          body: "Body only.",
        });
        expect(defaultSaved.target_vocab).toEqual([]);
      } finally {
        if (oldStateDir === undefined) delete process.env.PI_LAOSHI_STATE_DIR;
        else process.env.PI_LAOSHI_STATE_DIR = oldStateDir;
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
