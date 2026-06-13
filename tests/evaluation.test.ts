import { describe, expect, it } from "vitest";
import { evaluateLearnerProgress } from "../src/evaluation.js";

const activities = [
  { id: "pinyin-basics", type: "lesson" as const, title: "Pinyin Basics", level: "beginner", path: "", origin: "package" as const, editable: false },
  { id: "greetings-1", type: "lesson" as const, title: "Greetings 1", level: "beginner", path: "", origin: "package" as const, editable: false },
  { id: "numbers-1", type: "lesson" as const, title: "Numbers 1", level: "beginner", path: "", origin: "package" as const, editable: false },
  { id: "introduce-yourself", type: "exercise" as const, title: "Introduce Yourself", level: "beginner", path: "", origin: "package" as const, editable: false },
  { id: "measure-words-1", type: "exercise" as const, title: "Measure Words 1", level: "beginner", path: "", origin: "package" as const, editable: false },
];

describe("learner progress evaluation", () => {
  it("identifies a brand-new learner and recommends starter foundations", () => {
    const evaluation = evaluateLearnerProgress({
      vocabulary_counts: [],
      due_reviews: [],
      recent_vocabulary: [],
      evaluation_averages: [],
      settings: [{ key: "review_size", value: "10" }],
    }, activities);

    expect(evaluation.inferred_level).toBe("beginner");
    expect(evaluation.strengths).toContain("Ready to start a structured beginner path");
    expect(evaluation.weaknesses).toContain("No recorded vocabulary yet");
    expect(evaluation.review_recommendation.should_review).toBe(false);
    expect(evaluation.recommended_next_activities.map((activity) => activity.id)).toEqual([
      "pinyin-basics",
      "greetings-1",
      "numbers-1",
      "introduce-yourself",
    ]);
  });

  it("prioritizes due review and weak skill dimensions", () => {
    const evaluation = evaluateLearnerProgress({
      vocabulary_counts: [
        { status: "introduced", count: 12 },
        { status: "known", count: 3 },
      ],
      due_reviews: Array.from({ length: 6 }, (_, index) => ({ simplified: `词${index}` })),
      recent_vocabulary: [{ simplified: "你好", status: "introduced" }],
      evaluation_averages: [
        { dimension: "pinyin", average_score: 0.45 },
        { dimension: "tones", average_score: 0.62 },
        { dimension: "vocabulary", average_score: 0.86 },
      ],
      settings: [{ key: "review_size", value: "5" }],
    }, activities);

    expect(evaluation.inferred_level).toBe("beginner");
    expect(evaluation.review_recommendation).toEqual({ should_review: true, due_count: 6, suggested_size: 5 });
    expect(evaluation.strengths).toContain("Strong vocabulary performance");
    expect(evaluation.weaknesses).toEqual(expect.arrayContaining([
      "6 vocabulary items are due for review",
      "Needs pinyin practice",
      "Needs tones practice",
      "Vocabulary is mostly introduced or practicing, not yet known",
    ]));
    expect(evaluation.recommended_next_activities[0].id).toBe("pinyin-basics");
  });

  it("uses default review settings when profile settings are absent", () => {
    const evaluation = evaluateLearnerProgress({
      vocabulary_counts: [{ status: "introduced", count: 1 }],
      due_reviews: Array.from({ length: 7 }, (_, index) => ({ simplified: `词${index}` })),
      recent_vocabulary: [],
      evaluation_averages: [],
      settings: [],
    }, activities);

    expect(evaluation.review_recommendation).toEqual({ should_review: true, due_count: 7, suggested_size: 7 });
  });

  it("recognizes beginner-plus progress and recommends fewer next activities", () => {
    const evaluation = evaluateLearnerProgress({
      vocabulary_counts: [
        { status: "known", count: 35 },
        { status: "mastered", count: 20 },
        { status: "practicing", count: 10 },
      ],
      due_reviews: [],
      recent_vocabulary: [{ simplified: "老师", status: "known" }],
      evaluation_averages: [
        { dimension: "pinyin", average_score: 0.92 },
        { dimension: "tones", average_score: 0.88 },
        { dimension: "fluency", average_score: 0.84 },
      ],
      settings: [{ key: "review_size", value: "10" }],
    }, activities);

    expect(evaluation.inferred_level).toBe("beginner-plus");
    expect(evaluation.weaknesses).toEqual([]);
    expect(evaluation.strengths).toEqual(expect.arrayContaining([
      "55 known/mastered vocabulary items",
      "Strong pinyin performance",
      "Strong tones performance",
    ]));
    expect(evaluation.recommended_next_activities.length).toBeLessThanOrEqual(2);
    expect(evaluation.recommended_next_activities.map((activity) => activity.id)).toContain("measure-words-1");
  });
});
