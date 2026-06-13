import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LaoshiDatabase } from "../src/db.js";

let tempDir: string;
let db: LaoshiDatabase;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "pi-laoshi-"));
  db = new LaoshiDatabase(join(tempDir, "learning.duckdb"));
  await db.connect();
});

afterEach(async () => {
  db.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("LaoshiDatabase", () => {
  it("requires connect before manual migration", async () => {
    const disconnected = new LaoshiDatabase(":memory:");
    expect(disconnected.path).toBe(":memory:");
    await expect(disconnected.migrate()).rejects.toThrow(/not connected/);
    disconnected.close();
  });
  it("migrates, normalizes, and upserts vocabulary", async () => {
    await db.connect();
    const normalized = await db.upsertVocab({ simplified: "老師", pinyin: "lǎo shī", english_gloss: "teacher" });
    expect(normalized.simplified).toBe("老师");
    expect(normalized.traditional).toBe("老師");
    await expect(db.getVocabBySimplified("老師")).resolves.toMatchObject({ simplified: "老师" });

    const vocab = await db.upsertVocab({ simplified: "你好", pinyin: "nǐ hǎo", english_gloss: "hello" });
    expect(vocab.simplified).toBe("你好");

    const full = await db.upsertVocab({
      simplified: "老师",
      traditional: "老師",
      pinyin: "lǎo shī",
      english_gloss: "teacher",
      part_of_speech: "noun",
      hsk_level: 1,
      source: "test",
      status: "review",
      ease_score: 2.2,
      review_due_at: new Date(Date.now() - 1000).toISOString(),
      interval_days: 3,
      ease_factor: 2.2,
      review_count: 2,
      lapse_count: 1,
      last_reviewed_at: new Date().toISOString(),
    });
    expect(full.traditional).toBe("老師");
    await expect(db.dueReview()).resolves.toHaveLength(1);

    const updated = await db.upsertVocab({ simplified: "你好", status: "known" });
    expect(updated.status).toBe("known");
    expect(updated.pinyin).toBe("nǐ hǎo");
    await expect(db.getVocabBySimplified("不存在")).resolves.toBeNull();
    await expect(db.getVocabById("missing-id")).resolves.toBeNull();
  });

  it("records vocabulary events and schedules reviews", async () => {
    await expect(db.recordVocabEvent({ event_type: "recognized" })).rejects.toThrow(/requires vocab_id or simplified/);

    const event = await db.recordVocabEvent({ simplified: "再见", event_type: "produced", score: 1 });
    expect(event.vocab_id).toBeTruthy();

    let vocab = await db.getVocabById(String(event.vocab_id));
    expect(vocab.review_count).toBe(1);
    expect(vocab.review_due_at).toBeTruthy();

    await db.recordVocabEvent({
      vocab_id: String(event.vocab_id),
      session_id: "session-a",
      event_type: "recognized",
      student_answer: "zai jian",
      teacher_feedback: "Use tones: zài jiàn",
    });
    vocab = await db.getVocabById(String(event.vocab_id));
    expect(vocab.review_count).toBe(1);

    await db.recordVocabEvent({ vocab_id: String(event.vocab_id), event_type: "corrected", score: 0.2 });
    vocab = await db.getVocabById(String(event.vocab_id));
    expect(vocab.status).toBe("review");
    expect(vocab.lapse_count).toBe(1);

    await db.recordVocabEvent({ vocab_id: String(event.vocab_id), event_type: "recognized", score: 0.7 });
    vocab = await db.getVocabById(String(event.vocab_id));
    expect(vocab.status).toBe("practicing");

    await db.recordVocabEvent({ vocab_id: String(event.vocab_id), event_type: "produced", score: 1 });
    await db.recordVocabEvent({ vocab_id: String(event.vocab_id), event_type: "produced", score: 1 });
    vocab = await db.getVocabById(String(event.vocab_id));
    expect(vocab.status).toBe("known");

    const review = await db.recordVocabEvent({ simplified: "謝謝", event_type: "reviewed", score: 0.9 });
    const normalizedReviewVocab = await db.getVocabById(String(review.vocab_id));
    expect(normalizedReviewVocab.simplified).toBe("谢谢");
    await db.recordVocabEvent({ vocab_id: String(review.vocab_id), event_type: "reviewed", score: 0.9 });
    await db.recordVocabEvent({ vocab_id: String(review.vocab_id), event_type: "reviewed", score: 0.9 });
    await db.recordVocabEvent({ vocab_id: String(review.vocab_id), event_type: "reviewed", score: 0.9 });
    const reviewed = await db.getVocabById(String(review.vocab_id));
    expect(reviewed.status).toBe("known");

    const fallback = await db.recordVocabEvent({ simplified: "学生", event_type: "introduced" });
    const conn = await db.connect();
    await conn.run(
      "UPDATE vocabulary SET interval_days = NULL, ease_factor = NULL, ease_score = NULL, review_count = NULL, lapse_count = NULL, status = NULL WHERE id = $id",
      { id: String(fallback.vocab_id) },
    );
    await db.recordVocabEvent({ vocab_id: String(fallback.vocab_id), event_type: "reviewed", score: 0.8 });
    const fallbackVocab = await db.getVocabById(String(fallback.vocab_id));
    expect(fallbackVocab.status).toBe("practicing");
    await db.recordVocabEvent({ vocab_id: "missing-vocab-id", event_type: "reviewed", score: 1 });

    const profile = await db.profileSummary();
    expect(profile.vocabulary_counts.length).toBeGreaterThan(0);
  });

  it("tracks activities and evaluations", async () => {
    const activity = await db.startActivity({ session_id: "session-a", activity_type: "lesson", activity_name: "Greetings 1" });
    const unsessioned = await db.startActivity({ activity_type: "chat", activity_name: "Casual chat" });
    expect(unsessioned.id).toBeTruthy();
    const evaluation = await db.recordEvaluation({ activity_id: activity.id, dimension: "handwriting", score: 0.8, feedback: "Good" });
    const evaluationWithoutFeedback = await db.recordEvaluation({ activity_id: activity.id, dimension: "vocabulary", score: 0.7 });
    expect(evaluation.score).toBe(0.8);
    expect(evaluationWithoutFeedback.feedback).toBeUndefined();

    const finished = await db.finishActivity({ activity_id: activity.id, summary: "Completed intro greetings" });
    expect(finished.finished).toBe(true);
    const finishedWithoutSummary = await db.finishActivity({ activity_id: activity.id });
    expect(finishedWithoutSummary.summary).toBeNull();
  });

  it("stores settings and handwriting events", async () => {
    await expect(db.updateSetting({ key: "pinyin_visibility", value: "bad" })).rejects.toThrow(/pinyin_visibility/);
    await db.updateSetting({ key: "pinyin_visibility", value: "off" });
    const settings = await db.getSettings();
    expect(settings.some((setting) => setting.key === "pinyin_visibility" && setting.value === "off")).toBe(true);

    const handwriting = await db.recordHandwritingEvent({
      session_id: "session-a",
      image_ref: "image.png",
      target_text: "你",
      recognized_text: "你",
      correction_feedback: "Looks good",
      drill_feedback: "Repeat twice",
      score: 0.9,
    });
    expect(handwriting.id).toBeTruthy();
    const minimalHandwriting = await db.recordHandwritingEvent({});
    expect(minimalHandwriting.id).toBeTruthy();
  });
});
