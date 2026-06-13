# pi-laoshi: Agentic Standard Mandarin Learning Agent Plan

## Goal

Build **pi-laoshi** (“Pi Teacher”), a Standard Mandarin Chinese (Putonghua / 普通话) learning agent based on Pi Coding Agent. The agent acts as a teacher and evaluator while the student interacts naturally in a Pi session through:

- casual chat about Mandarin language/culture;
- practicing Standard Mandarin conversation;
- guided, pre-designed lessons;
- specific exercise tasks triggered by asking for them by name.

pi-laoshi explicitly focuses on mastery of Standard Mandarin Putonghua: simplified Chinese characters, Hanyu Pinyin, standard pronunciation/tones, and modern mainland standard usage. Traditional Chinese characters are out of scope for the learner model and should not be tracked as a parallel target; when Traditional characters appear in input or imported content, convert them to Simplified for learner-facing materials and tracking.

The primary initial learner profile is a beginner. Default lessons should be standard-length sessions of about 10–15 minutes.

pi-laoshi continuously maintains a learner vocabulary/progress database in DuckDB under the user’s Pi home area.

## Proposed Storage Location

Use a dedicated application directory under Pi's agent area:

```text
~/.pi/agent/laoshi/
├── learning.duckdb
├── state/              # non-DB learner state, sync metadata, settings
├── backups/
└── exports/
```

Default database file: `~/.pi/agent/laoshi/learning.duckdb`.

Allow override via environment variable or setting, e.g. `PI_LAOSHI_DB_PATH`.

All learner-state data that affects teaching decisions should live under this directory so it can be backed up and synchronized together. This includes DuckDB state, lesson/activity metadata, sync manifests, and any future scheduler/profile state files.

## Pi Integration Approach

Implement pi-laoshi as a Pi package/project that can provide:

1. **Extension** (`.pi/extensions/laoshi/` or packaged extension)
   - Registers language-learning tools.
   - Injects learner profile/context before each agent turn.
   - Tracks lesson/exercise sessions.
   - Stores vocabulary and evaluation results in DuckDB.

2. **Skills** (`.pi/skills/` or package `skills/`)
   - A `mandarin-teacher` skill containing Putonghua-focused pedagogy, correction style, and interaction rules.

3. **Prompt templates** (`.pi/prompts/` or package `prompts/`)
   - Optional slash-command shortcuts for common flows such as `/mandarin-chat`, `/conversation-practice`, `/review-vocab`.
   - Core workflow commands: `/laoshi-lesson`, `/laoshi-review`, `/laoshi-evaluate`, `/laoshi-settings`, and `/laoshi-handwriting`.
   - Pinyin visibility commands should be available at any time in a Pi session, such as `/laoshi-pinyin on`, `/laoshi-pinyin off`, and `/laoshi-pinyin hints-only`; changes should apply at the earliest safe/convenient turn.
   - State management commands: `/laoshi-sync`, `/laoshi-export`, and `/laoshi-import`.

4. **Lesson/exercise markdown assets**
   - Versioned pre-scripted markdown lesson files stored in the project/package.
   - Student-created custom lessons/exercises stored in the learner state directory or an optional project-local content directory, so learners can ask pi-laoshi to draft, save, revise, and later run their own lessons.
   - For example:

```text
content/
├── lessons/
│   ├── pinyin-basics.md
│   ├── greetings-1.md
│   └── numbers-1.md
└── exercises/
    ├── tones-minimal-pairs.md
    ├── introduce-yourself.md
    └── measure-words-1.md
```

The extension should expose lesson/exercise metadata to the agent, so a student can say “begin greetings 1” and the agent can load the right markdown file. It should include both packaged lessons and student-created lessons in the catalog, while clearly marking origin and editability.

## Core Features

### 1. Learner Vocabulary Database

Track words and phrases encountered, taught, practiced, corrected, and mastered.

Initial DuckDB tables:

- `vocabulary`
  - `id`
  - `simplified`
  - `pinyin`
  - `english_gloss`
  - `part_of_speech`
  - `hsk_level`
  - `source`
  - `first_seen_at`
  - `last_seen_at`
  - `status` (`introduced`, `practicing`, `review`, `known`, `mastered`)
  - `ease_score`
  - `review_due_at`

- `vocab_events`
  - `id`
  - `vocab_id`
  - `session_id`
  - `event_type` (`introduced`, `recognized`, `produced`, `corrected`, `reviewed`)
  - `student_answer`
  - `teacher_feedback`
  - `score`
  - `created_at`

- `activities`
  - `id`
  - `session_id`
  - `activity_type` (`chat`, `conversation`, `lesson`, `exercise`, `review`)
  - `activity_name`
  - `started_at`
  - `ended_at`
  - `summary`

- `evaluations`
  - `id`
  - `activity_id`
  - `dimension` (`vocabulary`, `grammar`, `tones`, `pinyin`, `fluency`, `comprehension`, `listening`, `speaking`, `reading`, `writing`, `handwriting`)
  - `score`
  - `feedback`
  - `created_at`

- `learner_settings`
  - `key`
  - `value`
  - `updated_at`
  - Initial settings include pinyin visibility, English-assistance preference, review size, and preferred practice domains.

- `handwriting_events`
  - `id`
  - `session_id`
  - `image_ref`
  - `recognized_text`
  - `target_text`
  - `correction_feedback`
  - `drill_feedback`
  - `score`
  - `created_at`

### 2. Teacher/Evaluator Behavior

pi-laoshi should:

- adapt difficulty based on known vocabulary and past scores;
- default to Mandarin for teaching interactions and use English when requested, or when needed for safety, clarity, advice, workflow/status messages, or other non-teaching content that will not spoil the learning effort;
- allow pinyin visibility to be toggled during a session and respect the setting in subsequent teaching turns;
- evaluate student attempts with concise corrective feedback;
- provide immediate correction after each learner sentence by default;
- prioritize Standard Mandarin pronunciation, Hanyu Pinyin, simplified characters, and modern mainland usage;
- correct tone mistakes, but do not treat tone mistakes as high-priority when the utterance is otherwise understandable;
- convert Traditional Chinese input/content to Simplified for learning materials and tracking, without explicitly teaching Traditional variants unless briefly necessary for context;
- record new vocabulary and performance events;
- suggest short, frequent spaced-review sessions when the algorithm says it is a suitable time, asking before starting;
- distinguish “introduced vocabulary” from vocabulary the student has actually produced correctly;
- track skill areas separately, including listening, speaking, reading, writing/handwriting, pinyin, tones, grammar, vocabulary, fluency, and comprehension.

### 3. Pre-scripted Markdown Lessons and Exercises

Each lesson/exercise markdown file should include frontmatter:

```markdown
---
id: greetings-1
type: lesson
title: Greetings 1
level: beginner
target_vocab:
  - 你好
  - 您好
  - 再见
estimated_minutes: 10
---
```

Body sections:

- objective;
- teacher script;
- target vocabulary;
- grammar or pronunciation notes;
- guided practice steps;
- evaluation rubric;
- completion criteria;
- database recording instructions.

### 4. Agent Tools

Likely custom extension tools:

- `laoshi_get_profile` — summarize learner level, known vocab, due reviews.
- `laoshi_upsert_vocab` — add/update vocabulary entries.
- `laoshi_record_vocab_event` — record student interaction with a vocabulary item.
- `laoshi_list_lessons` — list available lesson/exercise markdown assets.
- `laoshi_load_activity` — load a specific lesson or exercise by id/name.
- `laoshi_create_activity` / `laoshi_update_activity` — save or revise student-created lesson/exercise markdown assets.
- `laoshi_start_activity` / `laoshi_finish_activity` — track current activity.
- `laoshi_record_evaluation` — save rubric scores and feedback.
- `laoshi_due_review` — fetch due vocabulary for spaced repetition.
- `laoshi_evaluate_learner` — evaluate the full historical learner database and infer current level, strengths, weaknesses, and recommended next lessons.
- `laoshi_get_settings` / `laoshi_update_settings` — inspect and change learner settings such as pinyin visibility and review size.
- `laoshi_record_handwriting_event` — record handwritten character practice, corrections, generated drill feedback, and progress.
- `laoshi_sync_state` — synchronize the local learner state directory with configured Azure Blob Storage.
- `laoshi_export_state` — create a portable backup/archive of DuckDB and related learner state.
- `laoshi_import_state` — restore learner state from a backup/archive.

### 5. State Synchronization and Backup

Support keeping multiple computers reasonably in sync with the same learner state.

Slash commands:

- `/laoshi-sync` — manually synchronize `~/.pi/agent/laoshi/` with a configured Azure Blob Storage account.
- `/laoshi-export` — export a backup archive containing `learning.duckdb`, all conversation-derived learner events/corrections, and all related state files.
- `/laoshi-import` — import a backup archive and restore local learner state.

Design notes:

- Treat `~/.pi/agent/laoshi/` as the authoritative state bundle; avoid scattering learner progress elsewhere.
- Before sync/export, create a consistent DuckDB checkpoint or snapshot and avoid copying a database while writes are active.
- Keep a local sync manifest with device id, last synced revision/time, and content checksums.
- Prefer simple last-writer-wins or explicit conflict files for the MVP; do not silently merge divergent DuckDB files.
- Store blob credentials/config outside exported learner backups unless the user explicitly asks to include them.
- Ensure import makes a timestamped local backup before replacing current state.
- Sync is manual-only for the MVP; do not auto-sync or prompt at session end unless this decision is revisited.

## Milestones

### Milestone 1 — Project Foundation

- Add TypeScript project scaffolding.
- Add DuckDB dependency and database initialization helper.
- Define schema migrations.
- Add sample lessons/exercises.
- Add Pi extension entry point.

### Milestone 2 — Vocabulary Tracking MVP

- Implement `laoshi_upsert_vocab`, `laoshi_record_vocab_event`, and profile summary.
- Inject learner context into agent turns.
- Manually test casual Mandarin chat and vocabulary persistence.

### Milestone 3 — Lesson/Exercise Runner

- Define lesson markdown format.
- Implement lesson discovery and loading tools.
- Add starter beginner lessons.
- Support student-created lesson/exercise files, including create/update tools and safe filename/id validation.
- Support natural-language lesson triggering by exposing lesson catalog in prompt context.

### Milestone 4 — Evaluation and Review

- Implement activity/evaluation tables and tools.
- Add scoring rubrics.
- Add due-review query logic for short, frequent review sessions.
- Implement `/laoshi-evaluate` against the full historical learner database, including recommended next lessons matched to inferred beginner skill level and practical needs.
- Teach the agent when to mark vocabulary as introduced/practicing/known/mastered.

### Milestone 5 — Packaging and UX

- Package as a Pi package with extension, skill, prompts, and content.
- Add setup documentation.
- Add `/laoshi-sync` command for synchronizing DuckDB and related state through Azure Blob Storage.
- Add `/laoshi-export` and `/laoshi-import` commands for portable learner-state backups.
- Add `/laoshi-settings`, `/laoshi-pinyin`, `/laoshi-lesson`, `/laoshi-review`, `/laoshi-evaluate`, and `/laoshi-handwriting` command UX.
- Add tests for DB migrations, markdown parsing, tool behavior, sync manifests, and backup/restore flows.

### Milestone 6 — Multimodal Practice

- Add eventual speech/audio support for pronunciation and listening/speaking practice.
- Add pasted-photo interpretation for mixed handwritten pages containing many characters, words, or sentences.
- Generate handwriting corrections and writing-drill feedback, and record results into learner progress.

## Open Design Questions

- Resolved: store the database under `~/.pi/agent/laoshi/` by default because Pi's global agent resources and settings live under `~/.pi/agent/`.
- Resolved: vocabulary extraction and progress recording should be explicit via pi-laoshi tools only for the MVP. This keeps DB writes intentional, auditable, and less noisy; automatic extraction can be considered later as an opt-in candidate-suggestion layer.
- Resolved: start with simple interval-based due dates for the MVP, while shaping the schema so SM-2 can be added without migration pain. Store scheduling metadata such as interval, ease factor, review count, lapse count, last reviewed time, and due time.
- Resolved: lesson content should support both package-provided lessons and student-created custom lessons/exercises.
- Should custom lesson content be stored only under `~/.pi/agent/laoshi/`, or should project-local lesson directories also be supported?
- Resolved: Azure Blob Storage is the first sync provider for `/laoshi-sync`.
- Future question: should later sync providers use provider-specific SDKs or a generic object-store abstraction?
