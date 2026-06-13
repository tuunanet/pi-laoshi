import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { defaultDbPath, ensureLaoshiStateDirs } from "./paths.js";
import { DEFAULT_SETTINGS, validateSetting, validateSettings } from "./settings.js";

export type VocabStatus = "introduced" | "practicing" | "review" | "known" | "mastered";
export type VocabEventType = "introduced" | "recognized" | "produced" | "corrected" | "reviewed";
export type ActivityType = "chat" | "conversation" | "lesson" | "exercise" | "review";
export type EvaluationDimension =
  | "vocabulary"
  | "grammar"
  | "tones"
  | "pinyin"
  | "fluency"
  | "comprehension"
  | "listening"
  | "speaking"
  | "reading"
  | "writing"
  | "handwriting";

export interface VocabInput {
  simplified: string;
  traditional?: string;
  pinyin?: string;
  english_gloss?: string;
  part_of_speech?: string;
  hsk_level?: number;
  source?: string;
  status?: VocabStatus;
  ease_score?: number;
  review_due_at?: string;
  interval_days?: number;
  ease_factor?: number;
  review_count?: number;
  lapse_count?: number;
  last_reviewed_at?: string;
}

export interface VocabEventInput {
  vocab_id?: string;
  simplified?: string;
  session_id?: string;
  event_type: VocabEventType;
  student_answer?: string;
  teacher_feedback?: string;
  score?: number;
}

export interface StartActivityInput {
  session_id?: string;
  activity_type: ActivityType;
  activity_name: string;
}

export interface FinishActivityInput {
  activity_id: string;
  summary?: string;
}

export interface EvaluationInput {
  activity_id: string;
  dimension: EvaluationDimension;
  score: number;
  feedback?: string;
}

export interface HandwritingEventInput {
  session_id?: string;
  image_ref?: string;
  recognized_text?: string;
  target_text?: string;
  correction_feedback?: string;
  drill_feedback?: string;
  score?: number;
}

export interface LearnerSettingInput {
  key: string;
  value: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

export class LaoshiDatabase {
  private connection?: DuckDBConnection;

  constructor(private readonly dbPath = defaultDbPath()) {}

  get path(): string {
    return this.dbPath;
  }

  async connect(): Promise<DuckDBConnection> {
    if (this.connection) return this.connection;
    if (this.dbPath !== ":memory:") {
      await mkdir(dirname(this.dbPath), { recursive: true });
      await ensureLaoshiStateDirs(dirname(this.dbPath));
    }
    const instance = await DuckDBInstance.fromCache(this.dbPath);
    this.connection = await instance.connect();
    await this.migrate();
    return this.connection;
  }

  close(): void {
    this.connection?.closeSync();
    this.connection = undefined;
  }

  async migrate(): Promise<void> {
    const db = this.connection;
    if (!db) throw new Error("Database is not connected");

    await db.run(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TIMESTAMP DEFAULT current_timestamp
      );
    `);

    await db.run(`
      CREATE TABLE IF NOT EXISTS vocabulary (
        id VARCHAR PRIMARY KEY,
        simplified VARCHAR NOT NULL UNIQUE,
        traditional VARCHAR,
        pinyin VARCHAR,
        english_gloss VARCHAR,
        part_of_speech VARCHAR,
        hsk_level INTEGER,
        source VARCHAR,
        first_seen_at TIMESTAMP DEFAULT current_timestamp,
        last_seen_at TIMESTAMP DEFAULT current_timestamp,
        status VARCHAR DEFAULT 'introduced',
        ease_score DOUBLE DEFAULT 2.5,
        review_due_at TIMESTAMP,
        interval_days DOUBLE DEFAULT 0,
        ease_factor DOUBLE DEFAULT 2.5,
        review_count INTEGER DEFAULT 0,
        lapse_count INTEGER DEFAULT 0,
        last_reviewed_at TIMESTAMP
      );
    `);

    await db.run("ALTER TABLE vocabulary ADD COLUMN IF NOT EXISTS interval_days DOUBLE DEFAULT 0;");
    await db.run("ALTER TABLE vocabulary ADD COLUMN IF NOT EXISTS ease_factor DOUBLE DEFAULT 2.5;");
    await db.run("ALTER TABLE vocabulary ADD COLUMN IF NOT EXISTS review_count INTEGER DEFAULT 0;");
    await db.run("ALTER TABLE vocabulary ADD COLUMN IF NOT EXISTS lapse_count INTEGER DEFAULT 0;");
    await db.run("ALTER TABLE vocabulary ADD COLUMN IF NOT EXISTS last_reviewed_at TIMESTAMP;");

    await db.run(`
      CREATE TABLE IF NOT EXISTS vocab_events (
        id VARCHAR PRIMARY KEY,
        vocab_id VARCHAR NOT NULL,
        session_id VARCHAR,
        event_type VARCHAR NOT NULL,
        student_answer VARCHAR,
        teacher_feedback VARCHAR,
        score DOUBLE,
        created_at TIMESTAMP DEFAULT current_timestamp
      );
    `);

    await db.run(`
      CREATE TABLE IF NOT EXISTS activities (
        id VARCHAR PRIMARY KEY,
        session_id VARCHAR,
        activity_type VARCHAR NOT NULL,
        activity_name VARCHAR NOT NULL,
        started_at TIMESTAMP DEFAULT current_timestamp,
        ended_at TIMESTAMP,
        summary VARCHAR
      );
    `);

    await db.run(`
      CREATE TABLE IF NOT EXISTS evaluations (
        id VARCHAR PRIMARY KEY,
        activity_id VARCHAR NOT NULL,
        dimension VARCHAR NOT NULL,
        score DOUBLE NOT NULL,
        feedback VARCHAR,
        created_at TIMESTAMP DEFAULT current_timestamp
      );
    `);

    await db.run(`
      CREATE TABLE IF NOT EXISTS learner_settings (
        key VARCHAR PRIMARY KEY,
        value VARCHAR NOT NULL,
        updated_at TIMESTAMP DEFAULT current_timestamp
      );
    `);

    await db.run(`
      CREATE TABLE IF NOT EXISTS handwriting_events (
        id VARCHAR PRIMARY KEY,
        session_id VARCHAR,
        image_ref VARCHAR,
        recognized_text VARCHAR,
        target_text VARCHAR,
        correction_feedback VARCHAR,
        drill_feedback VARCHAR,
        score DOUBLE,
        created_at TIMESTAMP DEFAULT current_timestamp
      );
    `);

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      await db.run("INSERT OR IGNORE INTO learner_settings (key, value) VALUES ($key, $value);", { key, value });
    }

    await db.run("INSERT OR IGNORE INTO schema_migrations (version) VALUES (1);");
    await db.run("INSERT OR IGNORE INTO schema_migrations (version) VALUES (2);");
  }

  async upsertVocab(input: VocabInput) {
    const db = await this.connect();
    const id = randomUUID();
    await db.run(
      `
      INSERT INTO vocabulary (
        id, simplified, traditional, pinyin, english_gloss, part_of_speech,
        hsk_level, source, status, ease_score, review_due_at, interval_days,
        ease_factor, review_count, lapse_count, last_reviewed_at
      ) VALUES ($id, $simplified, $traditional, $pinyin, $english_gloss, $part_of_speech,
        $hsk_level, $source, $status, $ease_score, CAST($review_due_at AS TIMESTAMP),
        $interval_days, $ease_factor, $review_count, $lapse_count, CAST($last_reviewed_at AS TIMESTAMP))
      ON CONFLICT (simplified) DO UPDATE SET
        traditional = COALESCE(excluded.traditional, vocabulary.traditional),
        pinyin = COALESCE(excluded.pinyin, vocabulary.pinyin),
        english_gloss = COALESCE(excluded.english_gloss, vocabulary.english_gloss),
        part_of_speech = COALESCE(excluded.part_of_speech, vocabulary.part_of_speech),
        hsk_level = COALESCE(excluded.hsk_level, vocabulary.hsk_level),
        source = COALESCE(excluded.source, vocabulary.source),
        status = COALESCE(excluded.status, vocabulary.status),
        ease_score = COALESCE(excluded.ease_score, vocabulary.ease_score),
        review_due_at = COALESCE(excluded.review_due_at, vocabulary.review_due_at),
        interval_days = COALESCE(excluded.interval_days, vocabulary.interval_days),
        ease_factor = COALESCE(excluded.ease_factor, vocabulary.ease_factor),
        review_count = COALESCE(excluded.review_count, vocabulary.review_count),
        lapse_count = COALESCE(excluded.lapse_count, vocabulary.lapse_count),
        last_reviewed_at = COALESCE(excluded.last_reviewed_at, vocabulary.last_reviewed_at),
        last_seen_at = now();
      `,
      {
        id,
        simplified: input.simplified,
        traditional: input.traditional ?? null,
        pinyin: input.pinyin ?? null,
        english_gloss: input.english_gloss ?? null,
        part_of_speech: input.part_of_speech ?? null,
        hsk_level: input.hsk_level ?? null,
        source: input.source ?? null,
        status: input.status ?? "introduced",
        ease_score: input.ease_score ?? 2.5,
        review_due_at: input.review_due_at ?? null,
        interval_days: input.interval_days ?? 0,
        ease_factor: input.ease_factor ?? input.ease_score ?? 2.5,
        review_count: input.review_count ?? 0,
        lapse_count: input.lapse_count ?? 0,
        last_reviewed_at: input.last_reviewed_at ?? null,
      },
    );
    return this.getVocabBySimplified(input.simplified);
  }

  async getVocabBySimplified(simplified: string) {
    const db = await this.connect();
    const result = await db.run("SELECT * FROM vocabulary WHERE simplified = $simplified LIMIT 1", { simplified });
    return (await result.getRowObjectsJson())[0] ?? null;
  }

  async getVocabById(id: string) {
    const db = await this.connect();
    const result = await db.run("SELECT * FROM vocabulary WHERE id = $id LIMIT 1", { id });
    return (await result.getRowObjectsJson())[0] ?? null;
  }

  private async applyVocabularyScheduling(vocabId: string, input: VocabEventInput) {
    const db = await this.connect();
    await db.run("UPDATE vocabulary SET last_seen_at = current_timestamp WHERE id = $vocab_id", { vocab_id: vocabId });

    if (input.score === undefined) return;
    const row = await this.getVocabById(vocabId);
    if (!row) return;

    const score = clamp(input.score, 0, 1);
    const currentInterval = Math.max(0, Number(row.interval_days ?? 0));
    const reviewCount = Number(row.review_count ?? 0);
    const lapseCount = Number(row.lapse_count ?? 0);
    const currentEase = Number(row.ease_factor ?? row.ease_score ?? 2.5);

    let nextStatus = String(row.status ?? "introduced") as VocabStatus;
    let nextEase = currentEase;
    let nextInterval = currentInterval;
    let nextLapses = lapseCount;

    if (score < 0.6 || input.event_type === "corrected") {
      nextStatus = "review";
      nextEase = clamp(currentEase - 0.2, 1.3, 3.0);
      nextInterval = 1;
      nextLapses += 1;
    } else if (score >= 0.9 && input.event_type === "produced") {
      nextStatus = reviewCount >= 2 ? "known" : "practicing";
      nextEase = clamp(currentEase + 0.08, 1.3, 3.0);
      nextInterval = currentInterval <= 0 ? 1 : Math.max(2, Math.round(currentInterval * nextEase));
    } else if (score >= 0.8) {
      nextStatus = input.event_type === "reviewed" && reviewCount >= 3 ? "known" : "practicing";
      nextInterval = currentInterval <= 0 ? 1 : Math.max(1, Math.round(currentInterval * nextEase));
    } else {
      nextStatus = "practicing";
      nextEase = clamp(currentEase - 0.05, 1.3, 3.0);
      nextInterval = 1;
    }

    await db.run(
      `UPDATE vocabulary SET
        status = $status,
        ease_score = $ease,
        ease_factor = $ease,
        interval_days = $interval_days,
        review_count = $review_count,
        lapse_count = $lapse_count,
        last_reviewed_at = current_timestamp,
        review_due_at = CAST($review_due_at AS TIMESTAMP)
       WHERE id = $vocab_id`,
      {
        vocab_id: vocabId,
        status: nextStatus,
        ease: nextEase,
        interval_days: nextInterval,
        review_count: reviewCount + 1,
        lapse_count: nextLapses,
        review_due_at: isoDaysFromNow(nextInterval),
      },
    );
  }

  async recordVocabEvent(input: VocabEventInput) {
    const db = await this.connect();
    let vocabId = input.vocab_id;
    if (!vocabId) {
      if (!input.simplified) throw new Error("recordVocabEvent requires vocab_id or simplified");
      const vocab = await this.upsertVocab({ simplified: input.simplified });
      vocabId = String(vocab.id);
    }
    const id = randomUUID();
    await db.run(
      `INSERT INTO vocab_events (id, vocab_id, session_id, event_type, student_answer, teacher_feedback, score)
       VALUES ($id, $vocab_id, $session_id, $event_type, $student_answer, $teacher_feedback, $score)`,
      {
        id,
        vocab_id: vocabId,
        session_id: input.session_id ?? null,
        event_type: input.event_type,
        student_answer: input.student_answer ?? null,
        teacher_feedback: input.teacher_feedback ?? null,
        score: input.score ?? null,
      },
    );
    await this.applyVocabularyScheduling(vocabId, input);
    return { id, vocab_id: vocabId, ...input };
  }

  async startActivity(input: StartActivityInput) {
    const db = await this.connect();
    const id = randomUUID();
    await db.run(
      `INSERT INTO activities (id, session_id, activity_type, activity_name)
       VALUES ($id, $session_id, $activity_type, $activity_name)`,
      { id, session_id: input.session_id ?? null, activity_type: input.activity_type, activity_name: input.activity_name },
    );
    return { id, ...input };
  }

  async finishActivity(input: FinishActivityInput) {
    const db = await this.connect();
    await db.run(
      `UPDATE activities SET ended_at = current_timestamp, summary = COALESCE($summary, summary) WHERE id = $activity_id`,
      { activity_id: input.activity_id, summary: input.summary ?? null },
    );
    return { activity_id: input.activity_id, summary: input.summary ?? null, finished: true };
  }

  async recordEvaluation(input: EvaluationInput) {
    const db = await this.connect();
    const id = randomUUID();
    await db.run(
      `INSERT INTO evaluations (id, activity_id, dimension, score, feedback)
       VALUES ($id, $activity_id, $dimension, $score, $feedback)`,
      { id, ...input, feedback: input.feedback ?? null },
    );
    return { id, ...input };
  }

  async recordHandwritingEvent(input: HandwritingEventInput) {
    const db = await this.connect();
    const id = randomUUID();
    await db.run(
      `INSERT INTO handwriting_events (
        id, session_id, image_ref, recognized_text, target_text, correction_feedback, drill_feedback, score
       ) VALUES ($id, $session_id, $image_ref, $recognized_text, $target_text, $correction_feedback, $drill_feedback, $score)`,
      {
        id,
        session_id: input.session_id ?? null,
        image_ref: input.image_ref ?? null,
        recognized_text: input.recognized_text ?? null,
        target_text: input.target_text ?? null,
        correction_feedback: input.correction_feedback ?? null,
        drill_feedback: input.drill_feedback ?? null,
        score: input.score ?? null,
      },
    );
    return { id, ...input };
  }

  async getSettings() {
    const db = await this.connect();
    const result = await db.run("SELECT key, value, updated_at FROM learner_settings ORDER BY key");
    return result.getRowObjectsJson();
  }

  async updateSetting(input: LearnerSettingInput) {
    const validated = validateSetting(input);
    const db = await this.connect();
    await db.run(
      `INSERT INTO learner_settings (key, value, updated_at) VALUES ($key, $value, now())
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()`,
      { key: validated.key, value: validated.value },
    );
    return validated;
  }

  async updateSettings(settings: LearnerSettingInput[]) {
    const updated = [];
    for (const setting of validateSettings(settings)) updated.push(await this.updateSetting(setting));
    return updated;
  }

  async dueReview(limit = 10) {
    const db = await this.connect();
    const result = await db.run(
      `SELECT * FROM vocabulary
       WHERE review_due_at IS NOT NULL AND review_due_at <= current_timestamp
       ORDER BY review_due_at ASC, last_seen_at ASC
       LIMIT $limit`,
      { limit },
    );
    return result.getRowObjectsJson();
  }

  async profileSummary() {
    const db = await this.connect();
    const counts = await (await db.run("SELECT status, count(*) AS count FROM vocabulary GROUP BY status ORDER BY status")).getRowObjectsJson();
    const due = await this.dueReview(10);
    const recent = await (await db.run("SELECT simplified, pinyin, english_gloss, status, review_due_at FROM vocabulary ORDER BY last_seen_at DESC LIMIT 20")).getRowObjectsJson();
    const evals = await (await db.run("SELECT dimension, avg(score) AS average_score FROM evaluations GROUP BY dimension ORDER BY dimension")).getRowObjectsJson();
    const settings = await this.getSettings();
    return {
      db_path: this.dbPath,
      vocabulary_counts: counts,
      due_reviews: due,
      recent_vocabulary: recent,
      evaluation_averages: evals,
      settings,
    };
  }
}
