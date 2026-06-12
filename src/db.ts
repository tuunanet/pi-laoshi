import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";

export type VocabStatus = "introduced" | "practicing" | "review" | "known" | "mastered";
export type VocabEventType = "introduced" | "recognized" | "produced" | "corrected" | "reviewed";
export type ActivityType = "chat" | "conversation" | "lesson" | "exercise" | "review";
export type EvaluationDimension = "vocabulary" | "grammar" | "tones" | "pinyin" | "fluency" | "comprehension";

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

export function defaultDbPath(): string {
  return process.env.PI_LAOSHI_DB_PATH ?? join(homedir(), ".pi", "agent", "laoshi", "learning.duckdb");
}

export class LaoshiDatabase {
  private connection?: DuckDBConnection;

  constructor(private readonly dbPath = defaultDbPath()) {}

  get path(): string {
    return this.dbPath;
  }

  async connect(): Promise<DuckDBConnection> {
    if (this.connection) return this.connection;
    if (this.dbPath !== ":memory:") await mkdir(dirname(this.dbPath), { recursive: true });
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
        review_due_at TIMESTAMP
      );
    `);

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

    await db.run("INSERT OR IGNORE INTO schema_migrations (version) VALUES (1);");
  }

  async upsertVocab(input: VocabInput) {
    const db = await this.connect();
    const id = randomUUID();
    await db.run(
      `
      INSERT INTO vocabulary (
        id, simplified, traditional, pinyin, english_gloss, part_of_speech,
        hsk_level, source, status, ease_score, review_due_at
      ) VALUES ($id, $simplified, $traditional, $pinyin, $english_gloss, $part_of_speech,
        $hsk_level, $source, $status, $ease_score, CAST($review_due_at AS TIMESTAMP))
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
      },
    );
    return this.getVocabBySimplified(input.simplified);
  }

  async getVocabBySimplified(simplified: string) {
    const db = await this.connect();
    const result = await db.run("SELECT * FROM vocabulary WHERE simplified = $simplified LIMIT 1", { simplified });
    return (await result.getRowObjectsJson())[0] ?? null;
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

  async dueReview(limit = 10) {
    const db = await this.connect();
    const result = await db.run(
      `SELECT * FROM vocabulary
       WHERE review_due_at IS NOT NULL AND review_due_at <= current_timestamp
       ORDER BY review_due_at ASC
       LIMIT $limit`,
      { limit },
    );
    return result.getRowObjectsJson();
  }

  async profileSummary() {
    const db = await this.connect();
    const counts = await (await db.run("SELECT status, count(*) AS count FROM vocabulary GROUP BY status ORDER BY status")).getRowObjectsJson();
    const due = await this.dueReview(10);
    const recent = await (await db.run("SELECT simplified, pinyin, english_gloss, status FROM vocabulary ORDER BY last_seen_at DESC LIMIT 20")).getRowObjectsJson();
    const evals = await (await db.run("SELECT dimension, avg(score) AS average_score FROM evaluations GROUP BY dimension ORDER BY dimension")).getRowObjectsJson();
    return { db_path: this.dbPath, vocabulary_counts: counts, due_reviews: due, recent_vocabulary: recent, evaluation_averages: evals };
  }
}
