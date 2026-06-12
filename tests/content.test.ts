import { describe, expect, it } from "vitest";
import { listActivities, loadActivity, parseMarkdownActivity } from "../src/content.js";

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
});
