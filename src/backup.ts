import { createGunzip, createGzip } from "node:zlib";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, posix, relative, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { defaultLaoshiStateDir, ensureLaoshiStateDirs } from "./paths.js";

export interface BackupFileManifest {
  path: string;
  bytes: number;
}

export interface BackupManifest {
  format: "pi-laoshi-state-v1";
  created_at: string;
  files: BackupFileManifest[];
}

interface BackupArchive {
  manifest: BackupManifest;
  files: Array<{ path: string; data: string }>;
}

export interface ExportStateOptions {
  stateDir?: string;
  outputPath?: string;
}

export interface ImportStateOptions {
  archivePath: string;
  stateDir?: string;
}

function toPosixPath(path: string): string {
  return path.split(sep).join(posix.sep);
}

function assertSafeRelativePath(path: string): void {
  if (!path || path.startsWith("/") || path.includes("..") || path.split(posix.sep).includes("")) {
    throw new Error(`Unsafe archive path: ${path}`);
  }
}

async function collectFiles(root: string, current = root): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const files: string[] = [];
  for (const entry of entries) {
    const full = join(current, entry.name);
    const rel = toPosixPath(relative(root, full));
    if (rel === "backups" || rel.startsWith("backups/") || rel === "exports" || rel.startsWith("exports/")) continue;
    if (entry.isDirectory()) files.push(...await collectFiles(root, full));
    else if (entry.isFile()) files.push(rel);
  }
  return files.sort();
}

export async function listStateFiles(stateDir = defaultLaoshiStateDir()): Promise<string[]> {
  return collectFiles(stateDir);
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/gu, "-");
}

async function gzipJsonToFile(value: unknown, outputPath: string): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.tmp-${process.pid}`;
  await writeFile(tempPath, JSON.stringify(value), "utf8");
  try {
    await pipeline(createReadStream(tempPath), createGzip(), createWriteStream(outputPath));
  } finally {
    await rm(tempPath, { force: true });
  }
}

async function readGzipJson(path: string): Promise<BackupArchive> {
  const chunks: Buffer[] = [];
  const stream = createReadStream(path).pipe(createGunzip());
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const archive = JSON.parse(Buffer.concat(chunks).toString("utf8")) as BackupArchive;
  if (archive.manifest?.format !== "pi-laoshi-state-v1" || !Array.isArray(archive.files)) {
    throw new Error("Invalid pi-laoshi backup archive");
  }
  return archive;
}

export async function exportLaoshiState(options: ExportStateOptions = {}) {
  const stateDir = options.stateDir ?? defaultLaoshiStateDir();
  await ensureLaoshiStateDirs(stateDir);
  const archivePath = options.outputPath ?? join(stateDir, "exports", `pi-laoshi-${timestamp()}.json.gz`);
  const paths = await listStateFiles(stateDir);
  const files = await Promise.all(
    paths.map(async (path) => {
      assertSafeRelativePath(path);
      const data = await readFile(join(stateDir, path));
      return { path, data: data.toString("base64") };
    }),
  );
  const manifest: BackupManifest = {
    format: "pi-laoshi-state-v1",
    created_at: new Date().toISOString(),
    files: files.map((file) => ({ path: file.path, bytes: Buffer.byteLength(file.data, "base64") })),
  };

  await gzipJsonToFile({ manifest, files } satisfies BackupArchive, archivePath);
  return { archivePath, manifest };
}

async function clearRestorableState(stateDir: string): Promise<void> {
  const entries = await readdir(stateDir, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.name !== "backups" && entry.name !== "exports")
      .map((entry) => rm(join(stateDir, entry.name), { recursive: true, force: true })),
  );
}

export async function importLaoshiState(options: ImportStateOptions) {
  const stateDir = options.stateDir ?? defaultLaoshiStateDir();
  await ensureLaoshiStateDirs(stateDir);
  const preImportBackupPath = join(stateDir, "backups", `pre-import-${basename(options.archivePath)}-${timestamp()}.json.gz`);
  await exportLaoshiState({ stateDir, outputPath: preImportBackupPath });

  const archive = await readGzipJson(options.archivePath);
  await clearRestorableState(stateDir);
  const restoredFiles = archive.files.map((file) => file.path).sort();
  for (const file of archive.files) {
    assertSafeRelativePath(file.path);
    const output = join(stateDir, file.path);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, Buffer.from(file.data, "base64"));
  }
  await ensureLaoshiStateDirs(stateDir);
  return { preImportBackupPath, restoredFiles, manifest: archive.manifest };
}
