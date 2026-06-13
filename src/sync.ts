import { BlobServiceClient } from "@azure/storage-blob";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { defaultLaoshiStateDir, ensureLaoshiStateDirs } from "./paths.js";
import { listStateFiles } from "./backup.js";

export interface SyncFileManifest {
  path: string;
  bytes: number;
  sha256: string;
}

export interface SyncManifest {
  format: "pi-laoshi-sync-v1";
  revision: string;
  device_id: string;
  created_at: string;
  files: SyncFileManifest[];
}

export interface AzureSyncConfig {
  connectionString: string;
  containerName: string;
  prefix?: string;
}

export interface LocalSyncState {
  device_id: string;
  last_remote_revision?: string;
  last_synced_at?: string;
}

export interface SyncOptions {
  stateDir?: string;
  config?: AzureSyncConfig;
  dryRun?: boolean;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/gu, "");
}

function blobName(config: AzureSyncConfig, path: string): string {
  const prefix = config.prefix ? trimSlashes(config.prefix) : "";
  return prefix ? `${prefix}/${path}` : path;
}

export function getAzureSyncConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AzureSyncConfig {
  const connectionString = env.PI_LAOSHI_AZURE_CONNECTION_STRING ?? env.AZURE_STORAGE_CONNECTION_STRING;
  const containerName = env.PI_LAOSHI_AZURE_CONTAINER;
  if (!connectionString || !containerName) {
    throw new Error("Azure sync requires PI_LAOSHI_AZURE_CONTAINER and PI_LAOSHI_AZURE_CONNECTION_STRING or AZURE_STORAGE_CONNECTION_STRING");
  }
  return { connectionString, containerName, prefix: env.PI_LAOSHI_AZURE_PREFIX };
}

async function sha256File(path: string): Promise<{ bytes: number; sha256: string }> {
  const data = await readFile(path);
  return { bytes: data.byteLength, sha256: createHash("sha256").update(data).digest("hex") };
}

export async function createSyncManifest(
  stateDir = defaultLaoshiStateDir(),
  options: { deviceId?: string; revision?: string } = {},
): Promise<SyncManifest> {
  const files = await Promise.all(
    (await listStateFiles(stateDir)).map(async (path) => ({ path, ...(await sha256File(join(stateDir, path))) })),
  );
  return {
    format: "pi-laoshi-sync-v1",
    revision: options.revision ?? randomUUID(),
    device_id: options.deviceId ?? randomUUID(),
    created_at: new Date().toISOString(),
    files,
  };
}

async function localSyncStatePath(stateDir: string): Promise<string> {
  const dir = join(stateDir, "state");
  await mkdir(dir, { recursive: true });
  return join(dir, "sync-manifest.json");
}

export async function readLocalSyncState(stateDir = defaultLaoshiStateDir()): Promise<LocalSyncState | null> {
  try {
    return JSON.parse(await readFile(await localSyncStatePath(stateDir), "utf8")) as LocalSyncState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeLocalSyncState(stateDir: string, state: LocalSyncState): Promise<void> {
  const path = await localSyncStatePath(stateDir);
  await writeFile(path, JSON.stringify(state, null, 2), "utf8");
}

async function downloadRemoteManifest(config: AzureSyncConfig): Promise<SyncManifest | null> {
  const service = BlobServiceClient.fromConnectionString(config.connectionString);
  const container = service.getContainerClient(config.containerName);
  const blob = container.getBlockBlobClient(blobName(config, "sync/manifest.json"));
  if (!(await blob.exists())) return null;
  const downloaded = await blob.downloadToBuffer();
  return JSON.parse(downloaded.toString("utf8")) as SyncManifest;
}

async function uploadState(config: AzureSyncConfig, stateDir: string, manifest: SyncManifest): Promise<void> {
  const service = BlobServiceClient.fromConnectionString(config.connectionString);
  const container = service.getContainerClient(config.containerName);
  await container.createIfNotExists();
  for (const file of manifest.files) {
    await container.getBlockBlobClient(blobName(config, `files/${file.path}`)).uploadFile(join(stateDir, file.path), {
      blobHTTPHeaders: { blobContentType: "application/octet-stream" },
    });
  }
  await container
    .getBlockBlobClient(blobName(config, "sync/manifest.json"))
    .upload(JSON.stringify(manifest, null, 2), Buffer.byteLength(JSON.stringify(manifest, null, 2)), {
      blobHTTPHeaders: { blobContentType: "application/json" },
    });
}

export async function syncState(options: SyncOptions = {}) {
  const stateDir = options.stateDir ?? defaultLaoshiStateDir();
  await ensureLaoshiStateDirs(stateDir);
  const localState = (await readLocalSyncState(stateDir)) ?? { device_id: randomUUID() };
  const localManifest = await createSyncManifest(stateDir, { deviceId: localState.device_id });
  const config = options.config ?? getAzureSyncConfigFromEnv();

  if (options.dryRun) return { status: "dry-run" as const, localManifest };

  const remoteManifest = await downloadRemoteManifest(config);
  if (remoteManifest && !localState.last_remote_revision) {
    return { status: "needs-import" as const, localManifest, remoteManifest };
  }
  if (remoteManifest && localState.last_remote_revision && remoteManifest.revision !== localState.last_remote_revision) {
    const conflictPath = join(stateDir, "state", `sync-conflict-${new Date().toISOString().replace(/[:.]/gu, "-")}.json`);
    await mkdir(dirname(conflictPath), { recursive: true });
    await writeFile(conflictPath, JSON.stringify({ localState, localManifest, remoteManifest }, null, 2), "utf8");
    return { status: "conflict" as const, conflictPath, localManifest, remoteManifest };
  }

  await uploadState(config, stateDir, localManifest);
  await writeLocalSyncState(stateDir, {
    device_id: localState.device_id,
    last_remote_revision: localManifest.revision,
    last_synced_at: new Date().toISOString(),
  });
  return { status: "uploaded" as const, localManifest, remoteManifest };
}
