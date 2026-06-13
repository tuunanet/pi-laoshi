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
  it("migrates and upserts vocabulary", async () => {
    const vocab = await db.upsertVocab({ simplified: "你好", pinyin: "nǐ hǎo", english_gloss: "hello" });
    expect(vocab.simplified).toBe("你好");

    const updated = await db.upsertVocab({ simplified: "你好", status: "known" });
    expect(updated.status).toBe("known");
    expect(updated.pinyin).toBe("nǐ hǎo");
  });

  it("records vocabulary events and schedules reviews", async () => {
    const event = await db.recordVocabEvent({ simplified: "再见", event_type: "produced", score: 1 });
    expect(event.vocab_id).toBeTruthy();

    const vocab = await db.getVocabById(String(event.vocab_id));
    expect(vocab.review_count).toBe(1);
    expect(vocab.review_due_at).toBeTruthy();

    const profile = await db.profileSummary();
    expect(profile.vocabulary_counts.length).toBeGreaterThan(0);
  });

  it("tracks activities and evaluations", async () => {
    const activity = await db.startActivity({ activity_type: "lesson", activity_name: "Greetings 1" });
    const evaluation = await db.recordEvaluation({ activity_id: activity.id, dimension: "handwriting", score: 0.8 });
    expect(evaluation.score).toBe(0.8);

    const finished = await db.finishActivity({ activity_id: activity.id, summary: "Completed intro greetings" });
    expect(finished.finished).toBe(true);
  });

  it("stores settings and handwriting events", async () => {
    await db.updateSetting({ key: "pinyin_visibility", value: "off" });
    const settings = await db.getSettings();
    expect(settings.some((setting) => setting.key === "pinyin_visibility" && setting.value === "off")).toBe(true);

    const handwriting = await db.recordHandwritingEvent({ target_text: "你", recognized_text: "你", score: 0.9 });
    expect(handwriting.id).toBeTruthy();
  });
});
