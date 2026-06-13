import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

const blobStore = vi.hoisted(() => new Map<string, Buffer>());

vi.mock("@azure/storage-blob", () => ({
  BlobServiceClient: {
    fromConnectionString: vi.fn(() => ({
      getContainerClient: vi.fn(() => ({
        createIfNotExists: vi.fn(async () => undefined),
        getBlockBlobClient: vi.fn((name: string) => ({
          exists: vi.fn(async () => blobStore.has(name)),
          downloadToBuffer: vi.fn(async () => blobStore.get(name) ?? Buffer.from("")),
          uploadFile: vi.fn(async (path: string) => {
            blobStore.set(name, await readFile(path));
          }),
          upload: vi.fn(async (data: string) => {
            blobStore.set(name, Buffer.from(data));
          }),
        })),
      })),
    })),
  },
}));

import { createSyncManifest, getAzureSyncConfigFromEnv, readLocalSyncState, syncState, writeLocalSyncState } from "../src/sync.js";

describe("state sync helpers", () => {
  beforeEach(() => {
    blobStore.clear();
  });
  it("creates deterministic manifests with checksums", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pi-laoshi-sync-"));
    try {
      await mkdir(join(stateDir, "state"), { recursive: true });
      await writeFile(join(stateDir, "learning.duckdb"), "db");
      await writeFile(join(stateDir, "state", "settings.json"), "{}");

      const manifest = await createSyncManifest(stateDir, { deviceId: "device-a", revision: "rev-1" });
      expect(manifest.device_id).toBe("device-a");
      expect(manifest.revision).toBe("rev-1");
      expect(manifest.files.map((file) => file.path)).toEqual(["learning.duckdb", "state/settings.json"]);
      expect(manifest.files[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it("reads Azure sync configuration from pi-laoshi environment variables", () => {
    const env = {
      PI_LAOSHI_AZURE_CONNECTION_STRING: "UseDevelopmentStorage=true",
      PI_LAOSHI_AZURE_CONTAINER: "laoshi",
      PI_LAOSHI_AZURE_PREFIX: "user-a",
    };
    expect(getAzureSyncConfigFromEnv(env)).toEqual({
      connectionString: "UseDevelopmentStorage=true",
      containerName: "laoshi",
      prefix: "user-a",
    });
    expect(() => getAzureSyncConfigFromEnv({})).toThrow(/PI_LAOSHI_AZURE_CONTAINER/);
  });

  it("propagates invalid local sync state", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pi-laoshi-sync-invalid-"));
    try {
      await mkdir(join(stateDir, "state"), { recursive: true });
      await writeFile(join(stateDir, "state", "sync-manifest.json"), "not json");
      await expect(readLocalSyncState(stateDir)).rejects.toThrow();
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it("supports dry-run sync without contacting Azure", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pi-laoshi-sync-dry-"));
    try {
      await writeFile(join(stateDir, "learning.duckdb"), "db");
      const result = await syncState({
        stateDir,
        dryRun: true,
        config: { connectionString: "UseDevelopmentStorage=true", containerName: "laoshi", prefix: "tests" },
      });
      expect(result.status).toBe("dry-run");
      expect(result.localManifest.files.map((file) => file.path)).toEqual(["learning.duckdb"]);
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it("can dry-run with environment config and default state directory", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pi-laoshi-sync-default-"));
    const oldState = process.env.PI_LAOSHI_STATE_DIR;
    const oldContainer = process.env.PI_LAOSHI_AZURE_CONTAINER;
    const oldConnection = process.env.AZURE_STORAGE_CONNECTION_STRING;
    try {
      process.env.PI_LAOSHI_STATE_DIR = stateDir;
      process.env.PI_LAOSHI_AZURE_CONTAINER = "laoshi";
      process.env.AZURE_STORAGE_CONNECTION_STRING = "UseDevelopmentStorage=true";
      await writeFile(join(stateDir, "learning.duckdb"), "db");
      const result = await syncState({ dryRun: true });
      expect(result.status).toBe("dry-run");
    } finally {
      if (oldState === undefined) delete process.env.PI_LAOSHI_STATE_DIR;
      else process.env.PI_LAOSHI_STATE_DIR = oldState;
      if (oldContainer === undefined) delete process.env.PI_LAOSHI_AZURE_CONTAINER;
      else process.env.PI_LAOSHI_AZURE_CONTAINER = oldContainer;
      if (oldConnection === undefined) delete process.env.AZURE_STORAGE_CONNECTION_STRING;
      else process.env.AZURE_STORAGE_CONNECTION_STRING = oldConnection;
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it("can dry-run with environment config and generated manifest defaults", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pi-laoshi-sync-env-"));
    const oldContainer = process.env.PI_LAOSHI_AZURE_CONTAINER;
    const oldConnection = process.env.AZURE_STORAGE_CONNECTION_STRING;
    try {
      await writeFile(join(stateDir, "learning.duckdb"), "db");
      process.env.PI_LAOSHI_AZURE_CONTAINER = "laoshi";
      process.env.AZURE_STORAGE_CONNECTION_STRING = "UseDevelopmentStorage=true";
      const generated = await createSyncManifest(stateDir);
      expect(generated.device_id).toBeTruthy();
      expect(generated.revision).toBeTruthy();
      const result = await syncState({ stateDir, dryRun: true });
      expect(result.status).toBe("dry-run");
    } finally {
      if (oldContainer === undefined) delete process.env.PI_LAOSHI_AZURE_CONTAINER;
      else process.env.PI_LAOSHI_AZURE_CONTAINER = oldContainer;
      if (oldConnection === undefined) delete process.env.AZURE_STORAGE_CONNECTION_STRING;
      else process.env.AZURE_STORAGE_CONNECTION_STRING = oldConnection;
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it("does not overwrite existing remote state from a new local device", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pi-laoshi-sync-new-device-"));
    try {
      await writeFile(join(stateDir, "learning.duckdb"), "local-db");
      blobStore.set("sync/manifest.json", Buffer.from(JSON.stringify({
        format: "pi-laoshi-sync-v1",
        revision: "remote-rev",
        device_id: "device-remote",
        created_at: new Date().toISOString(),
        files: [{ path: "learning.duckdb", bytes: 9, sha256: "0".repeat(64) }],
      })));
      blobStore.set("files/learning.duckdb", Buffer.from("remote-db"));

      const result = await syncState({
        stateDir,
        config: { connectionString: "UseDevelopmentStorage=true", containerName: "laoshi" },
      });
      expect(result.status).toBe("needs-import");
      expect(blobStore.get("files/learning.duckdb")?.toString()).toBe("remote-db");
      if (result.status === "needs-import") {
        expect(result.remoteManifest.revision).toBe("remote-rev");
      }
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it("uploads state and writes local sync state", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pi-laoshi-sync-upload-"));
    try {
      await writeFile(join(stateDir, "learning.duckdb"), "db");
      const result = await syncState({
        stateDir,
        config: { connectionString: "UseDevelopmentStorage=true", containerName: "laoshi", prefix: "/tests/" },
      });
      expect(result.status).toBe("uploaded");
      expect(blobStore.has("tests/files/learning.duckdb")).toBe(true);
      expect(blobStore.has("tests/sync/manifest.json")).toBe(true);
      const localState = await readLocalSyncState(stateDir);
      expect(localState?.last_remote_revision).toBe(result.localManifest.revision);
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it("writes a conflict file when remote revision diverged", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pi-laoshi-sync-conflict-"));
    try {
      await writeFile(join(stateDir, "learning.duckdb"), "db");
      await writeLocalSyncState(stateDir, { device_id: "device-a", last_remote_revision: "old-rev" });
      blobStore.set("sync/manifest.json", Buffer.from(JSON.stringify({
        format: "pi-laoshi-sync-v1",
        revision: "new-rev",
        device_id: "device-b",
        created_at: new Date().toISOString(),
        files: [],
      })));

      const result = await syncState({
        stateDir,
        config: { connectionString: "UseDevelopmentStorage=true", containerName: "laoshi" },
      });
      expect(result.status).toBe("conflict");
      if (result.status === "conflict") {
        expect(await readFile(result.conflictPath, "utf8")).toContain("new-rev");
      }
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });
});
