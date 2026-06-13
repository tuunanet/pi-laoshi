# pi-laoshi: Agentic Chinese Language Learning Agent Plan

## Goal

Build **pi-laoshi** (“Pi Teacher”), a Chinese language learning agent based on Pi Coding Agent. The agent acts as a teacher and evaluator while the student interacts naturally in a Pi session through:

- casual chat about Chinese language/culture;
- practicing Chinese conversation;
- guided, pre-designed lessons;
- specific exercise tasks triggered by asking for them by name.

pi-laoshi continuously maintains a learner vocabulary/progress database in DuckDB under the user’s Pi home area.

## Proposed Storage Location

Use a dedicated application directory under Pi's agent area:

```text
~/.pi/agent/laoshi/
├── learning.duckdb
├── backups/
└── exports/
```

Default database file: `~/.pi/agent/laoshi/learning.duckdb`.

Allow override via environment variable or setting, e.g. `PI_LAOSHI_DB_PATH`.

## Pi Integration Approach

Implement pi-laoshi as a Pi package/project that can provide:

1. **Extension** (`.pi/extensions/laoshi/` or packaged extension)
   - Registers language-learning tools.
   - Injects learner profile/context before each agent turn.
   - Tracks lesson/exercise sessions.
   - Stores vocabulary and evaluation results in DuckDB.

2. **Skills** (`.pi/skills/` or package `skills/`)
   - A `chinese-teacher` skill containing pedagogy, correction style, and interaction rules.

3. **Prompt templates** (`.pi/prompts/` or package `prompts/`)
   - Optional slash-command shortcuts for common flows such as `/chinese-chat`, `/conversation-practice`, `/review-vocab`.

4. **Lesson/exercise markdown assets**
   - Versioned pre-scripted markdown lesson files stored in the project/package, for example:

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

The extension should expose lesson/exercise metadata to the agent, so a student can say “begin greetings 1” and the agent can load the right markdown file.

## Core Features

### 1. Learner Vocabulary Database

Track words and phrases encountered, taught, practiced, corrected, and mastered.

Initial DuckDB tables:

- `vocabulary`
  - `id`
  - `simplified`
  - `traditional`
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
  - `dimension` (`vocabulary`, `grammar`, `tones`, `pinyin`, `fluency`, `comprehension`)
  - `score`
  - `feedback`
  - `created_at`

### 2. Teacher/Evaluator Behavior

pi-laoshi should:

- adapt difficulty based on known vocabulary and past scores;
- explain in English when needed, but encourage Chinese output;
- evaluate student attempts with concise corrective feedback;
- record new vocabulary and performance events;
- suggest spaced-review items from the database;
- distinguish “introduced vocabulary” from vocabulary the student has actually produced correctly.

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
- `laoshi_start_activity` / `laoshi_finish_activity` — track current activity.
- `laoshi_record_evaluation` — save rubric scores and feedback.
- `laoshi_due_review` — fetch due vocabulary for spaced repetition.

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
- Manually test casual Chinese chat and vocabulary persistence.

### Milestone 3 — Lesson/Exercise Runner

- Define lesson markdown format.
- Implement lesson discovery and loading tools.
- Add starter beginner lessons.
- Support natural-language lesson triggering by exposing lesson catalog in prompt context.

### Milestone 4 — Evaluation and Review

- Implement activity/evaluation tables and tools.
- Add scoring rubrics.
- Add due-review query logic.
- Teach the agent when to mark vocabulary as introduced/practicing/known/mastered.

### Milestone 5 — Packaging and UX

- Package as a Pi package with extension, skill, prompts, and content.
- Add setup documentation.
- Add export/backup command for learner data.
- Add tests for DB migrations, markdown parsing, and tool behavior.

## Open Design Questions

- Resolved: store the database under `~/.pi/agent/laoshi/` by default because Pi's global agent resources and settings live under `~/.pi/agent/`.
- Resolved: vocabulary extraction and progress recording should be explicit via pi-laoshi tools only for the MVP. This keeps DB writes intentional, auditable, and less noisy; automatic extraction can be considered later as an opt-in candidate-suggestion layer.
- Resolved: start with simple interval-based due dates for the MVP, while shaping the schema so SM-2 can be added without migration pain. Store scheduling metadata such as interval, ease factor, review count, lapse count, last reviewed time, and due time.
- Should lesson content be global/package-provided only, or should project-local lesson directories also be supported?
