# pi-laoshi

pi-laoshi is a planned Chinese language learning agent for [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent).

The goal is to provide an interactive teacher and evaluator that can support Chinese conversation practice, guided lessons, vocabulary tracking, and spaced review using a local DuckDB learner database.

## Status

Early implementation stage. See [`docs/plans/pi-laoshi-agent-plan.md`](docs/plans/pi-laoshi-agent-plan.md) for the current implementation plan.

## Implemented foundation

- Pi package manifest for extension, skill, and prompt discovery
- Pi extension with learner profile, vocabulary, activity, settings, handwriting, evaluation, lesson listing/loading, custom activity, due-review, learner-evaluation, sync, export, and import tools
- DuckDB schema initialization under `~/.pi/agent/laoshi/learning.duckdb` by default
- `PI_LAOSHI_DB_PATH` and `PI_LAOSHI_STATE_DIR` overrides for local testing or alternate storage
- Chinese teacher skill
- Prompt templates and extension commands for chat, lessons, settings, pinyin visibility, vocabulary review, learner evaluation, handwriting practice, sync, export, and import
- Starter lessons and exercises in `content/`
- TypeScript build and Vitest tests with enforced 100% coverage for `src/`

## Development

```bash
npm install
npm run typecheck
npm test
npm run coverage
npm run build
```

## State backup and sync

Default learner state is stored under `~/.pi/agent/laoshi/`. Override with `PI_LAOSHI_STATE_DIR` or `PI_LAOSHI_DB_PATH` for development/testing.

Azure Blob sync uses:

- `PI_LAOSHI_AZURE_CONTAINER`
- `PI_LAOSHI_AZURE_CONNECTION_STRING` or `AZURE_STORAGE_CONNECTION_STRING`
- optional `PI_LAOSHI_AZURE_PREFIX`

## Planned features

- More beginner lessons and exercises
- Richer real-world Azure sync conflict workflows after MVP feedback
- Audio/speech pronunciation and listening practice
- More robust package UX and setup documentation

## License

MIT. See [`LICENSE`](LICENSE).

## Contributors

See [`CONTRIBUTORS.md`](CONTRIBUTORS.md).
