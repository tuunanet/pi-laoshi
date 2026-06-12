# pi-laoshi

pi-laoshi is a planned Chinese language learning agent for [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent).

The goal is to provide an interactive teacher and evaluator that can support Chinese conversation practice, guided lessons, vocabulary tracking, and spaced review using a local DuckDB learner database.

## Status

Early implementation stage. See [`docs/plans/pi-laoshi-agent-plan.md`](docs/plans/pi-laoshi-agent-plan.md) for the current implementation plan.

## Implemented foundation

- Pi package manifest for extension, skill, and prompt discovery
- Pi extension with learner profile, vocabulary, activity, evaluation, lesson listing/loading, and due-review tools
- DuckDB schema initialization under `~/.pi/laoshi/learning.duckdb` by default
- `PI_LAOSHI_DB_PATH` override for local testing or alternate storage
- Chinese teacher skill
- Prompt templates for chat, conversation practice, and vocabulary review
- Starter lessons and exercises in `content/`
- TypeScript build and Vitest tests

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

## Planned features

- Richer spaced repetition scheduling
- More beginner lessons and exercises
- Backup/export commands for learner data
- More robust package UX and setup documentation

## License

MIT. See [`LICENSE`](LICENSE).

## Contributors

See [`CONTRIBUTORS.md`](CONTRIBUTORS.md).
