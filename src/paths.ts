import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function defaultLaoshiStateDir(): string {
  if (process.env.PI_LAOSHI_STATE_DIR) return process.env.PI_LAOSHI_STATE_DIR;
  if (process.env.PI_LAOSHI_DB_PATH && process.env.PI_LAOSHI_DB_PATH !== ":memory:") {
    return dirname(process.env.PI_LAOSHI_DB_PATH);
  }
  return join(homedir(), ".pi", "agent", "laoshi");
}

export function defaultDbPath(): string {
  return process.env.PI_LAOSHI_DB_PATH ?? join(defaultLaoshiStateDir(), "learning.duckdb");
}

export function defaultCustomContentDir(): string {
  return join(defaultLaoshiStateDir(), "content");
}

export async function ensureLaoshiStateDirs(stateDir = defaultLaoshiStateDir()): Promise<void> {
  await Promise.all([
    mkdir(stateDir, { recursive: true }),
    mkdir(join(stateDir, "state"), { recursive: true }),
    mkdir(join(stateDir, "backups"), { recursive: true }),
    mkdir(join(stateDir, "exports"), { recursive: true }),
    mkdir(join(stateDir, "content", "lessons"), { recursive: true }),
    mkdir(join(stateDir, "content", "exercises"), { recursive: true }),
  ]);
}
