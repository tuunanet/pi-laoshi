import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { LaoshiDatabase } from "../../src/db.js";
import { listActivities, loadActivity } from "../../src/content.js";

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
]);

function textResult(text: string, details?: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text }], details };
}

export default function laoshiExtension(pi: ExtensionAPI) {
  const db = new LaoshiDatabase();

  pi.on("session_start", async (_event, ctx) => {
    await db.connect();
    ctx.ui.setStatus("pi-laoshi", "laoshi ready");
  });

  pi.on("session_shutdown", () => {
    db.close();
  });

  pi.on("resources_discover", async () => ({
    skillPaths: [new URL("../../skills", import.meta.url).pathname],
    promptPaths: [new URL("../../prompts", import.meta.url).pathname],
  }));

  pi.on("before_agent_start", async (event) => {
    const profile = await db.profileSummary();
    const lessons = await listActivities();
    return {
      systemPrompt: `${event.systemPrompt}\n\n## pi-laoshi learner context\nUse the pi-laoshi tools to persist vocabulary, activity, and evaluation progress when teaching Chinese. Distinguish introduced vocabulary from vocabulary the learner has produced correctly.\n\nCurrent learner profile:\n${JSON.stringify(profile, null, 2)}\n\nAvailable pi-laoshi activities:\n${JSON.stringify(lessons, null, 2)}\n`,
    };
  });

  pi.registerTool({
    name: "laoshi_get_profile",
    label: "Laoshi Profile",
    description: "Summarize the learner's Chinese vocabulary, due reviews, and evaluation averages.",
    promptSnippet: "Summarize pi-laoshi learner progress and due vocabulary reviews",
    promptGuidelines: ["Use laoshi_get_profile before adapting Chinese lesson difficulty or planning review."],
    parameters: Type.Object({}),
    async execute() {
      const profile = await db.profileSummary();
      return textResult(JSON.stringify(profile, null, 2), profile);
    },
  });

  pi.registerTool({
    name: "laoshi_upsert_vocab",
    label: "Laoshi Upsert Vocabulary",
    description: "Add or update a Chinese vocabulary entry in the learner database.",
    promptSnippet: "Add or update Chinese vocabulary progress",
    promptGuidelines: ["Use laoshi_upsert_vocab when new Chinese words are taught or an existing word status changes."],
    parameters: Type.Object({
      simplified: Type.String({ description: "Simplified Chinese word or phrase" }),
      traditional: Type.Optional(Type.String()),
      pinyin: Type.Optional(Type.String()),
      english_gloss: Type.Optional(Type.String()),
      part_of_speech: Type.Optional(Type.String()),
      hsk_level: Type.Optional(Type.Number()),
      source: Type.Optional(Type.String()),
      status: Type.Optional(StatusSchema),
      ease_score: Type.Optional(Type.Number()),
      review_due_at: Type.Optional(Type.String({ description: "ISO timestamp for next review" })),
    }),
    async execute(_toolCallId, params) {
      const vocab = await db.upsertVocab(params);
      return textResult(`Saved vocabulary: ${params.simplified}`, { vocab });
    },
  });

  pi.registerTool({
    name: "laoshi_record_vocab_event",
    label: "Laoshi Record Vocabulary Event",
    description: "Record a learner interaction with a vocabulary item.",
    promptSnippet: "Record Chinese vocabulary recognition, production, correction, or review events",
    promptGuidelines: ["Use laoshi_record_vocab_event when the learner recognizes, produces, reviews, or is corrected on a vocabulary item."],
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
    description: "List available pi-laoshi lessons and exercises.",
    promptSnippet: "List available Chinese lessons and exercises",
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
    promptSnippet: "Load a Chinese lesson or exercise markdown script",
    promptGuidelines: ["Use laoshi_load_activity when starting a named Chinese lesson or exercise."],
    parameters: Type.Object({ id_or_title: Type.String() }),
    async execute(_toolCallId, params) {
      const activity = await loadActivity(params.id_or_title);
      if (!activity) return textResult(`No lesson or exercise found for: ${params.id_or_title}`, { found: false });
      return textResult(`# ${activity.title}\n\n${activity.body}`, { activity });
    },
  });

  pi.registerTool({
    name: "laoshi_start_activity",
    label: "Laoshi Start Activity",
    description: "Record the start of a chat, conversation, lesson, exercise, or review activity.",
    promptSnippet: "Start tracking a Chinese learning activity",
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
    promptSnippet: "Finish tracking a Chinese learning activity",
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
    promptSnippet: "Record Chinese learning evaluation scores",
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
    promptSnippet: "Fetch due Chinese vocabulary review items",
    promptGuidelines: ["Use laoshi_due_review when the learner asks to review vocabulary or when planning practice."],
    parameters: Type.Object({ limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })) }),
    async execute(_toolCallId, params) {
      const due = await db.dueReview(params.limit ?? 10);
      return textResult(JSON.stringify(due, null, 2), { due });
    },
  });
}
