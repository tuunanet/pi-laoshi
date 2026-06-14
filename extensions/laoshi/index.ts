import { rm } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { LaoshiDatabase } from "../../src/db.js";
import { defaultDbPath, ensureLaoshiStateDirs } from "../../src/paths.js";
import { listActivities, loadActivity, saveCustomActivity } from "../../src/content.js";
import { exportLaoshiState, importLaoshiState } from "../../src/backup.js";
import { syncState } from "../../src/sync.js";
import { evaluateLearnerProgress, type LearnerProgressProfile } from "../../src/evaluation.js";

const StatusSchema = Type.Union([
  Type.Literal("introduced"),
  Type.Literal("practicing"),
  Type.Literal("review"),
  Type.Literal("known"),
  Type.Literal("mastered"),
]);

const EventTypeSchema = Type.Union([
  Type.Literal("introduced"),
  Type.Literal("recognized"),
  Type.Literal("produced"),
  Type.Literal("corrected"),
  Type.Literal("reviewed"),
]);

const ActivityKindSchema = Type.Union([
  Type.Literal("lesson"),
  Type.Literal("exercise"),
]);

const ActivityTypeSchema = Type.Union([
  Type.Literal("chat"),
  Type.Literal("conversation"),
  Type.Literal("lesson"),
  Type.Literal("exercise"),
  Type.Literal("review"),
]);

const EvaluationDimensionSchema = Type.Union([
  Type.Literal("vocabulary"),
  Type.Literal("grammar"),
  Type.Literal("tones"),
  Type.Literal("pinyin"),
  Type.Literal("fluency"),
  Type.Literal("comprehension"),
  Type.Literal("listening"),
  Type.Literal("speaking"),
  Type.Literal("reading"),
  Type.Literal("writing"),
  Type.Literal("handwriting"),
]);

const ActivitySaveSchema = Type.Object({
  id: Type.String({ description: "Lowercase id such as greetings-2" }),
  type: ActivityKindSchema,
  title: Type.String(),
  level: Type.String(),
  target_vocab: Type.Optional(Type.Array(Type.String())),
  estimated_minutes: Type.Optional(Type.Number({ minimum: 1, maximum: 120 })),
  body: Type.String({ description: "Markdown body with objective, script, practice, rubric, and recording instructions" }),
});

function textResult(text: string, details?: unknown) {
  return { content: [{ type: "text" as const, text }], details };
}

function parseSettingsArgs(args: string): Array<{ key: string; value: string }> {
  return args
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .map((pair) => {
      const index = pair.indexOf("=");
      if (index <= 0) throw new Error(`Expected key=value, got: ${pair}`);
      return { key: pair.slice(0, index), value: pair.slice(index + 1) };
    });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function laoshiExtension(pi: ExtensionAPI) {
  const db = new LaoshiDatabase();

  async function withClosedDatabase<T>(operation: () => Promise<T>): Promise<T> {
    db.close();
    try {
      return await operation();
    } finally {
      await db.connect();
    }
  }

  async function resetDuckDbState(): Promise<string> {
    db.close();
    const dbPath = defaultDbPath();
    if (dbPath !== ":memory:") {
      await ensureLaoshiStateDirs();
      await Promise.all([
        rm(dbPath, { force: true }),
        rm(`${dbPath}.wal`, { force: true }),
        rm(`${dbPath}.tmp`, { force: true }),
      ]);
    }
    await db.connect();
    return dbPath;
  }

  pi.on("session_start", async (_event, ctx) => {
    await db.connect();
    ctx.ui.setStatus("pi-laoshi", "laoshi ready");
  });

  pi.on("session_shutdown", () => {
    db.close();
  });

  pi.on("before_agent_start", async (event) => {
    const profile = await db.profileSummary();
    const lessons = await listActivities();
    return {
      systemPrompt: `${event.systemPrompt}\n\n## pi-laoshi learner context\nUse the pi-laoshi tools to persist vocabulary, activity, handwriting, settings, and evaluation progress when teaching Standard Mandarin (Putonghua). Respect pinyin_visibility from learner settings. Distinguish introduced vocabulary from vocabulary the learner has produced correctly. Convert Traditional Chinese input/content to Simplified for learner-facing materials and tracking. For casual chat startup, do not persist new vocabulary or vocabulary events until the learner responds or explicitly asks to learn the word.\n\nCurrent learner profile:\n${JSON.stringify(profile, null, 2)}\n\nAvailable pi-laoshi activities (custom items are editable; package items are read-only):\n${JSON.stringify(lessons, null, 2)}\n`,
    };
  });

  pi.registerCommand("laoshi-pinyin", {
    description: "Set pinyin visibility: on, off, or hints-only",
    handler: async (args, ctx) => {
      const value = args.trim();
      if (!["on", "off", "hints-only"].includes(value)) {
        ctx.ui.notify("Usage: /laoshi-pinyin on|off|hints-only", "warning");
        return;
      }
      await db.updateSetting({ key: "pinyin_visibility", value });
      ctx.ui.notify(`pi-laoshi pinyin visibility set to ${value}`, "info");
    },
  });

  pi.registerCommand("laoshi-settings", {
    description: "Show or update pi-laoshi settings. Example: /laoshi-settings review_size=8",
    handler: async (args, ctx) => {
      if (!args.trim()) {
        const settings = await db.getSettings();
        ctx.ui.notify(`pi-laoshi settings: ${JSON.stringify(settings)}`, "info");
        return;
      }
      const updated = await db.updateSettings(parseSettingsArgs(args));
      ctx.ui.notify(`Updated pi-laoshi settings: ${updated.map((s) => `${s.key}=${s.value}`).join(", ")}`, "info");
    },
  });

  pi.registerCommand("laoshi-lesson", {
    description: "Start a named Mandarin lesson/exercise or list available activities",
    handler: async (args, ctx) => {
      const request = args.trim() || "list available lessons and exercises";
      pi.sendUserMessage(`Use pi-laoshi tools to ${request === "list available lessons and exercises" ? request : `start the lesson or exercise named \"${request}\"`}.`);
    },
  });

  pi.registerCommand("laoshi-review", {
    description: "Start a short due-vocabulary review",
    handler: async (_args, ctx) => {
      pi.sendUserMessage("Use pi-laoshi tools to start a short due-vocabulary review session. Ask before introducing new material.");
    },
  });

  pi.registerCommand("laoshi-evaluate", {
    description: "Evaluate learner progress and recommend next Mandarin activities",
    handler: async (_args, ctx) => {
      pi.sendUserMessage("Use laoshi_evaluate_learner to evaluate my Mandarin progress, strengths, weaknesses, and recommended next lessons.");
    },
  });

  pi.registerCommand("laoshi-handwriting", {
    description: "Start handwriting or character-writing practice",
    handler: async (args, ctx) => {
      pi.sendUserMessage(`Start a pi-laoshi handwriting practice session${args.trim() ? ` for: ${args.trim()}` : ""}. If I attach an image, evaluate it and record handwriting feedback.`);
    },
  });

  pi.registerCommand("laoshi-export", {
    description: "Export a portable pi-laoshi learner-state backup",
    handler: async (_args, ctx) => {
      try {
        const result = await withClosedDatabase(() => exportLaoshiState());
        ctx.ui.notify(`Exported pi-laoshi state to ${result.archivePath}`, "info");
      } catch (error) {
        ctx.ui.notify(`pi-laoshi export failed: ${errorMessage(error)}`, "error");
      }
    },
  });

  pi.registerCommand("laoshi-import", {
    description: "Import a pi-laoshi learner-state backup archive",
    handler: async (args, ctx) => {
      const archivePath = args.trim();
      if (!archivePath) {
        ctx.ui.notify("Usage: /laoshi-import <archive-path>", "warning");
        return;
      }
      try {
        const result = await withClosedDatabase(() => importLaoshiState({ archivePath }));
        ctx.ui.notify(`Imported pi-laoshi state (${result.restoredFiles.length} files). Pre-import backup: ${result.preImportBackupPath}`, "info");
      } catch (error) {
        ctx.ui.notify(`pi-laoshi import failed: ${errorMessage(error)}`, "error");
      }
    },
  });

  pi.registerCommand("laoshi-sync", {
    description: "Manually synchronize pi-laoshi learner state with configured Azure Blob Storage",
    handler: async (args, ctx) => {
      const syncArgs = args.trim().split(/\s+/u).filter(Boolean);
      const dryRun = syncArgs.includes("--dry-run");
      const direction = syncArgs.includes("pull") ? "pull" as const : undefined;
      try {
        const result = await withClosedDatabase(() => syncState({ dryRun, direction }));
        const message = result.status === "needs-import"
          ? "pi-laoshi sync needs-import: remote state exists; local state was not uploaded"
          : `pi-laoshi sync ${result.status}`;
        ctx.ui.notify(message, ["conflict", "needs-import", "no-remote"].includes(result.status) ? "warning" : "info");
      } catch (error) {
        ctx.ui.notify(`pi-laoshi sync failed: ${errorMessage(error)}`, "error");
      }
    },
  });

  pi.registerCommand("laoshi-duckdb-reset", {
    description: "Release the pi-laoshi DuckDB lock and reset the learner database",
    handler: async (args, ctx) => {
      if (!args.trim().split(/\s+/u).includes("--confirm")) {
        ctx.ui.notify("Usage: /laoshi-duckdb-reset --confirm (destructive: deletes and recreates the pi-laoshi DuckDB database)", "warning");
        return;
      }
      try {
        const dbPath = await resetDuckDbState();
        ctx.ui.notify(`Reset pi-laoshi DuckDB database: ${dbPath}`, "info");
      } catch (error) {
        try {
          await db.connect();
        } catch {
          // Keep the original reset error as the user-facing failure.
        }
        ctx.ui.notify(`pi-laoshi DuckDB reset failed: ${errorMessage(error)}`, "error");
      }
    },
  });

  pi.registerTool({
    name: "laoshi_get_profile",
    label: "Laoshi Profile",
    description: "Summarize the learner's Chinese vocabulary, due reviews, settings, and evaluation averages.",
    promptSnippet: "Summarize pi-laoshi learner progress, settings, and due vocabulary reviews",
    promptGuidelines: ["Use laoshi_get_profile before adapting Mandarin lesson difficulty or planning review."],
    parameters: Type.Object({}),
    async execute() {
      const profile = await db.profileSummary();
      return textResult(JSON.stringify(profile, null, 2), profile);
    },
  });

  pi.registerTool({
    name: "laoshi_upsert_vocab",
    label: "Laoshi Upsert Vocabulary",
    description: "Add or update a Simplified Chinese vocabulary entry in the learner database.",
    promptSnippet: "Add or update Simplified Chinese vocabulary progress",
    parameters: Type.Object({
      simplified: Type.String({ description: "Simplified Chinese word or phrase" }),
      traditional: Type.Optional(Type.String({ description: "Only for source/reference; learner tracking remains Simplified-first" })),
      pinyin: Type.Optional(Type.String()),
      english_gloss: Type.Optional(Type.String()),
      part_of_speech: Type.Optional(Type.String()),
      hsk_level: Type.Optional(Type.Number()),
      source: Type.Optional(Type.String()),
      status: Type.Optional(StatusSchema),
      ease_score: Type.Optional(Type.Number()),
      review_due_at: Type.Optional(Type.String({ description: "ISO timestamp for next review" })),
    }),
    promptGuidelines: [
      "Use after a word has been explicitly taught in an active lesson/review, when the learner asks to learn it, or after the learner engages with it in conversation.",
      "Do not save optional preview words in the first turn of a casual chat before the learner responds.",
    ],
    async execute(_toolCallId, params) {
      const vocab = await db.upsertVocab(params);
      return textResult(`Saved vocabulary: ${params.simplified}`, { vocab });
    },
  });

  pi.registerTool({
    name: "laoshi_record_vocab_event",
    label: "Laoshi Record Vocabulary Event",
    description: "Record a learner interaction with a vocabulary item and update simple spaced-review scheduling when scored.",
    promptSnippet: "Record Mandarin vocabulary recognition, production, correction, or review events",
    promptGuidelines: [
      "Use when the learner recognizes, produces, reviews, or is corrected on a vocabulary item.",
      "Do not record teacher-only prompts as learner vocabulary events.",
      "Only include score for a real numeric evaluation; omit it for unscored events.",
    ],
    parameters: Type.Object({
      vocab_id: Type.Optional(Type.String()),
      simplified: Type.Optional(Type.String()),
      session_id: Type.Optional(Type.String()),
      event_type: EventTypeSchema,
      student_answer: Type.Optional(Type.String()),
      teacher_feedback: Type.Optional(Type.String()),
      score: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    }),
    async execute(_toolCallId, params) {
      const event = await db.recordVocabEvent(params);
      return textResult(`Recorded vocabulary event: ${params.event_type}`, { event });
    },
  });

  pi.registerTool({
    name: "laoshi_list_lessons",
    label: "Laoshi List Lessons",
    description: "List available package and custom pi-laoshi lessons and exercises.",
    promptSnippet: "List available Mandarin lessons and exercises",
    promptGuidelines: ["Use laoshi_list_lessons when the learner asks what lessons or exercises are available."],
    parameters: Type.Object({}),
    async execute() {
      const activities = await listActivities();
      return textResult(JSON.stringify(activities, null, 2), { activities });
    },
  });

  pi.registerTool({
    name: "laoshi_load_activity",
    label: "Laoshi Load Activity",
    description: "Load a specific pi-laoshi lesson or exercise by id or exact title.",
    promptSnippet: "Load a Mandarin lesson or exercise markdown script",
    promptGuidelines: ["Use laoshi_load_activity when starting a named Mandarin lesson or exercise."],
    parameters: Type.Object({ id_or_title: Type.String() }),
    async execute(_toolCallId, params) {
      const activity = await loadActivity(params.id_or_title);
      if (!activity) return textResult(`No lesson or exercise found for: ${params.id_or_title}`, { found: false });
      return textResult(`# ${activity.title}\n\n${activity.body}`, { activity });
    },
  });

  pi.registerTool({
    name: "laoshi_create_activity",
    label: "Laoshi Create Activity",
    description: "Create a student-editable custom Mandarin lesson or exercise under the pi-laoshi state directory.",
    promptSnippet: "Create a custom Mandarin lesson or exercise",
    promptGuidelines: ["Use laoshi_create_activity when the learner asks to save a custom lesson or exercise."],
    parameters: ActivitySaveSchema,
    async execute(_toolCallId, params) {
      const activity = await saveCustomActivity(params, { overwrite: false });
      return textResult(`Created custom ${params.type}: ${activity.id}`, { activity });
    },
  });

  pi.registerTool({
    name: "laoshi_update_activity",
    label: "Laoshi Update Activity",
    description: "Update or create a student-editable custom Mandarin lesson or exercise under the pi-laoshi state directory.",
    promptSnippet: "Update a custom Mandarin lesson or exercise",
    promptGuidelines: ["Use laoshi_update_activity when the learner asks to revise a custom lesson or exercise."],
    parameters: ActivitySaveSchema,
    async execute(_toolCallId, params) {
      const activity = await saveCustomActivity(params, { overwrite: true });
      return textResult(`Saved custom ${params.type}: ${activity.id}`, { activity });
    },
  });

  pi.registerTool({
    name: "laoshi_start_activity",
    label: "Laoshi Start Activity",
    description: "Record the start of a chat, conversation, lesson, exercise, or review activity.",
    promptSnippet: "Start tracking a Mandarin learning activity",
    parameters: Type.Object({
      session_id: Type.Optional(Type.String()),
      activity_type: ActivityTypeSchema,
      activity_name: Type.String(),
    }),
    async execute(_toolCallId, params) {
      const activity = await db.startActivity(params);
      return textResult(`Started activity: ${params.activity_name}`, { activity });
    },
  });

  pi.registerTool({
    name: "laoshi_finish_activity",
    label: "Laoshi Finish Activity",
    description: "Record completion of a pi-laoshi activity with an optional summary.",
    promptSnippet: "Finish tracking a Mandarin learning activity",
    parameters: Type.Object({ activity_id: Type.String(), summary: Type.Optional(Type.String()) }),
    async execute(_toolCallId, params) {
      const result = await db.finishActivity(params);
      return textResult(`Finished activity: ${params.activity_id}`, result);
    },
  });

  pi.registerTool({
    name: "laoshi_record_evaluation",
    label: "Laoshi Record Evaluation",
    description: "Save a rubric score and feedback for a learning activity.",
    promptSnippet: "Record Mandarin learning evaluation scores",
    parameters: Type.Object({
      activity_id: Type.String(),
      dimension: EvaluationDimensionSchema,
      score: Type.Number({ minimum: 0, maximum: 1 }),
      feedback: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params) {
      const evaluation = await db.recordEvaluation(params);
      return textResult(`Recorded ${params.dimension} evaluation`, { evaluation });
    },
  });

  pi.registerTool({
    name: "laoshi_due_review",
    label: "Laoshi Due Review",
    description: "Fetch vocabulary due for spaced review.",
    promptSnippet: "Fetch due Mandarin vocabulary review items",
    promptGuidelines: ["Use laoshi_due_review when the learner asks to review vocabulary or when planning practice."],
    parameters: Type.Object({ limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })) }),
    async execute(_toolCallId, params) {
      const due = await db.dueReview(params.limit ?? 10);
      return textResult(JSON.stringify(due, null, 2), { due });
    },
  });

  pi.registerTool({
    name: "laoshi_get_settings",
    label: "Laoshi Get Settings",
    description: "Inspect pi-laoshi learner settings such as pinyin visibility, English assistance, and review size.",
    promptSnippet: "Inspect pi-laoshi learner settings",
    parameters: Type.Object({}),
    async execute() {
      const settings = await db.getSettings();
      return textResult(JSON.stringify(settings, null, 2), { settings });
    },
  });

  pi.registerTool({
    name: "laoshi_update_settings",
    label: "Laoshi Update Settings",
    description: "Update pi-laoshi learner settings.",
    promptSnippet: "Update pinyin visibility, English assistance, review size, or practice-domain settings",
    promptGuidelines: ["Use laoshi_update_settings when the learner asks to change pinyin visibility or other pi-laoshi preferences."],
    parameters: Type.Object({
      settings: Type.Array(Type.Object({ key: Type.String(), value: Type.String() })),
    }),
    async execute(_toolCallId, params) {
      const updated = await db.updateSettings(params.settings);
      return textResult(`Updated settings: ${updated.map((s) => s.key).join(", ")}`, { updated });
    },
  });

  pi.registerTool({
    name: "laoshi_record_handwriting_event",
    label: "Laoshi Record Handwriting Event",
    description: "Record handwritten character practice, corrections, generated drill feedback, and progress.",
    promptSnippet: "Record Mandarin handwriting or character-writing feedback",
    parameters: Type.Object({
      session_id: Type.Optional(Type.String()),
      image_ref: Type.Optional(Type.String()),
      recognized_text: Type.Optional(Type.String()),
      target_text: Type.Optional(Type.String()),
      correction_feedback: Type.Optional(Type.String()),
      drill_feedback: Type.Optional(Type.String()),
      score: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    }),
    async execute(_toolCallId, params) {
      const event = await db.recordHandwritingEvent(params);
      return textResult("Recorded handwriting event", { event });
    },
  });

  pi.registerTool({
    name: "laoshi_export_state",
    label: "Laoshi Export State",
    description: "Create a portable backup archive of the pi-laoshi DuckDB database and learner state files.",
    promptSnippet: "Export a pi-laoshi learner-state backup archive",
    promptGuidelines: ["Use laoshi_export_state when the learner asks to back up or export pi-laoshi progress."],
    parameters: Type.Object({ output_path: Type.Optional(Type.String()) }),
    async execute(_toolCallId, params) {
      const result = await withClosedDatabase(() => exportLaoshiState({ outputPath: params.output_path }));
      return textResult(`Exported pi-laoshi state to ${result.archivePath}`, result);
    },
  });

  pi.registerTool({
    name: "laoshi_import_state",
    label: "Laoshi Import State",
    description: "Restore pi-laoshi learner state from a backup archive after making a pre-import backup.",
    promptSnippet: "Import a pi-laoshi learner-state backup archive",
    promptGuidelines: ["Use laoshi_import_state only when the learner explicitly asks to restore a pi-laoshi backup."],
    parameters: Type.Object({ archive_path: Type.String() }),
    async execute(_toolCallId, params) {
      const result = await withClosedDatabase(() => importLaoshiState({ archivePath: params.archive_path }));
      return textResult(`Imported pi-laoshi state from ${params.archive_path}`, result);
    },
  });

  pi.registerTool({
    name: "laoshi_sync_state",
    label: "Laoshi Sync State",
    description: "Synchronize local pi-laoshi learner state with configured Azure Blob Storage.",
    promptSnippet: "Synchronize pi-laoshi learner state with Azure Blob Storage",
    promptGuidelines: ["Use laoshi_sync_state when the learner asks to run manual pi-laoshi sync."],
    parameters: Type.Object({
      dry_run: Type.Optional(Type.Boolean()),
      direction: Type.Optional(Type.Union([Type.Literal("auto"), Type.Literal("pull")])),
    }),
    async execute(_toolCallId, params) {
      const result = await withClosedDatabase(() => syncState({ dryRun: params.dry_run, direction: params.direction }));
      return textResult(`pi-laoshi sync ${result.status}`, result);
    },
  });

  pi.registerTool({
    name: "laoshi_evaluate_learner",
    label: "Laoshi Evaluate Learner",
    description: "Evaluate the historical learner database and infer current level, strengths, weaknesses, and recommended next lessons.",
    promptSnippet: "Evaluate Mandarin learner progress and recommend next pi-laoshi lessons",
    promptGuidelines: ["Use laoshi_evaluate_learner for /laoshi-evaluate or when the learner asks for progress assessment."],
    parameters: Type.Object({}),
    async execute() {
      const profile = await db.profileSummary();
      const activities = await listActivities();
      const evaluation = evaluateLearnerProgress(profile as unknown as LearnerProgressProfile, activities);
      return textResult(JSON.stringify(evaluation, null, 2), evaluation);
    },
  });
}
