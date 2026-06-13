import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { defaultCustomContentDir, defaultDbPath, defaultLaoshiStateDir, ensureLaoshiStateDirs } from "../src/paths.js";

const oldState = process.env.PI_LAOSHI_STATE_DIR;
const oldDb = process.env.PI_LAOSHI_DB_PATH;

afterEach(() => {
  if (oldState === undefined) delete process.env.PI_LAOSHI_STATE_DIR;
  else process.env.PI_LAOSHI_STATE_DIR = oldState;
  if (oldDb === undefined) delete process.env.PI_LAOSHI_DB_PATH;
  else process.env.PI_LAOSHI_DB_PATH = oldDb;
});

describe("pi-laoshi paths", () => {
  it("respects state and database environment overrides", () => {
    process.env.PI_LAOSHI_STATE_DIR = "/tmp/laoshi-state";
    process.env.PI_LAOSHI_DB_PATH = "/tmp/elsewhere/learning.duckdb";
    expect(defaultLaoshiStateDir()).toBe("/tmp/laoshi-state");
    expect(defaultDbPath()).toBe("/tmp/elsewhere/learning.duckdb");
    expect(defaultCustomContentDir()).toBe("/tmp/laoshi-state/content");
  });

  it("derives state from database path when only database override is set", () => {
    delete process.env.PI_LAOSHI_STATE_DIR;
    process.env.PI_LAOSHI_DB_PATH = "/tmp/laoshi-db/learning.duckdb";
    expect(defaultLaoshiStateDir()).toBe("/tmp/laoshi-db");
  });

  it("creates the expected state bundle directories", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-laoshi-paths-"));
    try {
      await ensureLaoshiStateDirs(dir);
      expect(defaultDbPath()).toBe(process.env.PI_LAOSHI_DB_PATH ?? join(defaultLaoshiStateDir(), "learning.duckdb"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
