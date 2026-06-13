import { gzipSync } from "node:zlib";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { exportLaoshiState, importLaoshiState, listStateFiles } from "../src/backup.js";

describe("state backup and restore", () => {
  it("returns an empty file list for missing state directories and propagates other read errors", async () => {
    await expect(listStateFiles(join(tmpdir(), "missing-pi-laoshi-state"))).resolves.toEqual([]);
    const filePath = join(tmpdir(), `pi-laoshi-not-a-dir-${process.pid}`);
    await writeFile(filePath, "not a directory");
    try {
      await expect(listStateFiles(filePath)).rejects.toThrow();
    } finally {
      await rm(filePath, { force: true });
    }
  });
  it("exports default state directory from environment", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pi-laoshi-default-backup-"));
    const oldState = process.env.PI_LAOSHI_STATE_DIR;
    try {
      process.env.PI_LAOSHI_STATE_DIR = stateDir;
      await writeFile(join(stateDir, "learning.duckdb"), "db");
      const exported = await exportLaoshiState();
      expect(exported.archivePath).toContain(join(stateDir, "exports"));
      const imported = await importLaoshiState({ archivePath: exported.archivePath });
      expect(imported.restoredFiles).toContain("learning.duckdb");
    } finally {
      if (oldState === undefined) delete process.env.PI_LAOSHI_STATE_DIR;
      else process.env.PI_LAOSHI_STATE_DIR = oldState;
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it("exports state files without nesting backups or exports", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pi-laoshi-backup-"));
    try {
      await mkdir(join(stateDir, "state"), { recursive: true });
      await mkdir(join(stateDir, "exports"), { recursive: true });
      await mkdir(join(stateDir, "backups"), { recursive: true });
      await writeFile(join(stateDir, "learning.duckdb"), "db");
      await writeFile(join(stateDir, "state", "settings.json"), "{}");
      await writeFile(join(stateDir, "exports", "old.json.gz"), "ignore");
      await writeFile(join(stateDir, "backups", "old.json.gz"), "ignore");

      expect(await listStateFiles(stateDir)).toEqual(["learning.duckdb", "state/settings.json"]);

      const exported = await exportLaoshiState({ stateDir });
      expect(exported.archivePath).toContain(join(stateDir, "exports"));
      expect(exported.manifest.files.map((file) => file.path)).toEqual(["learning.duckdb", "state/settings.json"]);
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it("rejects invalid or unsafe archives", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pi-laoshi-invalid-"));
    try {
      const invalid = join(stateDir, "invalid.json.gz");
      await writeFile(invalid, gzipSync(JSON.stringify({ manifest: { format: "wrong" }, files: [] })));
      await expect(importLaoshiState({ archivePath: invalid, stateDir })).rejects.toThrow(/Invalid pi-laoshi backup/);

      const unsafe = join(stateDir, "unsafe.json.gz");
      await writeFile(unsafe, gzipSync(JSON.stringify({
        manifest: { format: "pi-laoshi-state-v1", created_at: new Date().toISOString(), files: [] },
        files: [{ path: "../evil", data: Buffer.from("bad").toString("base64") }],
      })));
      await expect(importLaoshiState({ archivePath: unsafe, stateDir })).rejects.toThrow(/Unsafe archive path/);
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it("imports an archive after creating a pre-import backup", async () => {
    const sourceDir = await mkdtemp(join(tmpdir(), "pi-laoshi-source-"));
    const targetDir = await mkdtemp(join(tmpdir(), "pi-laoshi-target-"));
    try {
      await writeFile(join(sourceDir, "learning.duckdb"), "new-db");
      await mkdir(join(sourceDir, "content", "lessons"), { recursive: true });
      await writeFile(join(sourceDir, "content", "lessons", "custom.md"), "lesson");
      const { archivePath } = await exportLaoshiState({ stateDir: sourceDir });

      await writeFile(join(targetDir, "learning.duckdb"), "old-db");
      const result = await importLaoshiState({ archivePath, stateDir: targetDir });

      expect(result.restoredFiles).toEqual(["content/lessons/custom.md", "learning.duckdb"]);
      expect(result.preImportBackupPath).toContain(join(targetDir, "backups"));
      await expect(readFile(join(targetDir, "learning.duckdb"), "utf8")).resolves.toBe("new-db");
      await expect(readFile(join(targetDir, "content", "lessons", "custom.md"), "utf8")).resolves.toBe("lesson");
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
      await rm(targetDir, { recursive: true, force: true });
    }
  });
});
