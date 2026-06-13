import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { listActivities, loadActivity, parseMarkdownActivity, saveCustomActivity } from "../src/content.js";

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
  it("parses markdown frontmatter", () => {
    const activity = parseMarkdownActivity(sample);
    expect(activity.id).toBe("sample-lesson");
    expect(activity.type).toBe("lesson");
    expect(activity.target_vocab).toEqual(["你好"]);
    expect(activity.body).toContain("Practice greetings");
  });

  it("discovers bundled activities", async () => {
    const activities = await listActivities();
    expect(activities.some((activity) => activity.id === "greetings-1")).toBe(true);
  });

  it("loads an activity by id", async () => {
    const activity = await loadActivity("greetings-1");
    expect(activity?.title).toBe("Greetings 1");
    expect(activity?.body).toContain("你好");
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
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
