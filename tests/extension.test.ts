import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const extensionBlobStore = vi.hoisted(() => new Map<string, Buffer>());

vi.mock("@azure/storage-blob", () => ({
  BlobServiceClient: {
    fromConnectionString: vi.fn(() => ({
      getContainerClient: vi.fn(() => ({
        createIfNotExists: vi.fn(async () => undefined),
        getBlockBlobClient: vi.fn((name: string) => ({
          exists: vi.fn(async () => extensionBlobStore.has(name)),
          downloadToBuffer: vi.fn(async () => extensionBlobStore.get(name) ?? Buffer.from("")),
          uploadFile: vi.fn(async (path: string) => {
            extensionBlobStore.set(name, await readFile(path));
          }),
          upload: vi.fn(async (data: string) => {
            extensionBlobStore.set(name, Buffer.from(data));
          }),
        })),
      })),
    })),
  },
}));

import laoshiExtension from "../extensions/laoshi/index.js";
import { LaoshiDatabase } from "../src/db.js";

interface RegisteredTool {
  name: string;
  execute: (...args: any[]) => Promise<any>;
}

interface RegisteredCommand {
  handler: (args: string, ctx: { ui: { notify: (message: string, level?: string) => void } }) => Promise<void>;
}

let tempDir: string;
let oldDbPath: string | undefined;
let oldStateDir: string | undefined;

function createMockPi() {
  const handlers = new Map<string, Function[]>();
  const tools: RegisteredTool[] = [];
  const commands = new Map<string, RegisteredCommand>();
  const notifications: Array<{ message: string; level?: string }> = [];
  return {
    handlers,
    tools,
    commands,
    notifications,
    on(name: string, handler: Function) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
    registerTool(tool: RegisteredTool) {
      tools.push(tool);
    },
    registerCommand(name: string, command: RegisteredCommand) {
      commands.set(name, command);
    },
    sendUserMessage() {},
    commandContext: { ui: { notify: (message: string, level?: string) => notifications.push({ message, level }) } },
  } as any;
}

beforeEach(async () => {
  extensionBlobStore.clear();
  tempDir = await mkdtemp(join(tmpdir(), "pi-laoshi-extension-"));
  oldDbPath = process.env.PI_LAOSHI_DB_PATH;
  oldStateDir = process.env.PI_LAOSHI_STATE_DIR;
  process.env.PI_LAOSHI_DB_PATH = join(tempDir, "learning.duckdb");
  process.env.PI_LAOSHI_STATE_DIR = tempDir;
});

afterEach(async () => {
  if (oldDbPath === undefined) delete process.env.PI_LAOSHI_DB_PATH;
  else process.env.PI_LAOSHI_DB_PATH = oldDbPath;
  if (oldStateDir === undefined) delete process.env.PI_LAOSHI_STATE_DIR;
  else process.env.PI_LAOSHI_STATE_DIR = oldStateDir;
  await rm(tempDir, { recursive: true, force: true });
});

describe("laoshi extension", () => {
  it("registers MVP commands and tools", () => {
    const pi = createMockPi();
    laoshiExtension(pi);

    expect([...pi.commands.keys()].sort()).toEqual([
      "laoshi-duckdb-reset",
      "laoshi-evaluate",
      "laoshi-export",
      "laoshi-handwriting",
      "laoshi-import",
      "laoshi-lesson",
      "laoshi-pinyin",
      "laoshi-review",
      "laoshi-settings",
      "laoshi-sync",
    ]);

    expect(pi.tools.map((tool: RegisteredTool) => tool.name)).toEqual(expect.arrayContaining([
      "laoshi_create_activity",
      "laoshi_due_review",
      "laoshi_evaluate_learner",
      "laoshi_export_state",
      "laoshi_get_profile",
      "laoshi_get_settings",
      "laoshi_import_state",
      "laoshi_record_handwriting_event",
      "laoshi_sync_state",
      "laoshi_update_activity",
      "laoshi_update_settings",
    ]));
  });

  it("closes the database around state export, import, and sync tools", async () => {
    const oldContainer = process.env.PI_LAOSHI_AZURE_CONTAINER;
    const oldConnection = process.env.AZURE_STORAGE_CONNECTION_STRING;
    const closeSpy = vi.spyOn(LaoshiDatabase.prototype, "close");
    try {
      process.env.PI_LAOSHI_AZURE_CONTAINER = "laoshi";
      process.env.AZURE_STORAGE_CONNECTION_STRING = "UseDevelopmentStorage=true";
      const pi = createMockPi();
      laoshiExtension(pi);

      const updateSettings = pi.tools.find((tool: RegisteredTool) => tool.name === "laoshi_update_settings");
      await updateSettings.execute("tool-call", { settings: [{ key: "pinyin_visibility", value: "off" }] });

      const exportState = pi.tools.find((tool: RegisteredTool) => tool.name === "laoshi_export_state");
      const exportResult = await exportState.execute("tool-call", {});

      const syncState = pi.tools.find((tool: RegisteredTool) => tool.name === "laoshi_sync_state");
      await syncState.execute("tool-call", { dry_run: true });

      const importState = pi.tools.find((tool: RegisteredTool) => tool.name === "laoshi_import_state");
      await importState.execute("tool-call", { archive_path: exportResult.details.archivePath });

      expect(closeSpy).toHaveBeenCalledTimes(3);
    } finally {
      closeSpy.mockRestore();
      if (oldContainer === undefined) delete process.env.PI_LAOSHI_AZURE_CONTAINER;
      else process.env.PI_LAOSHI_AZURE_CONTAINER = oldContainer;
      if (oldConnection === undefined) delete process.env.AZURE_STORAGE_CONNECTION_STRING;
      else process.env.AZURE_STORAGE_CONNECTION_STRING = oldConnection;
    }
  });

  it("resets the DuckDB learner database after explicit confirmation", async () => {
    const closeSpy = vi.spyOn(LaoshiDatabase.prototype, "close");
    try {
      const pi = createMockPi();
      laoshiExtension(pi);

      const upsertVocab = pi.tools.find((tool: RegisteredTool) => tool.name === "laoshi_upsert_vocab");
      await upsertVocab.execute("tool-call", { simplified: "你好", pinyin: "nǐ hǎo", english_gloss: "hello" });
      const updateSettings = pi.tools.find((tool: RegisteredTool) => tool.name === "laoshi_update_settings");
      await updateSettings.execute("tool-call", { settings: [{ key: "pinyin_visibility", value: "off" }] });

      await pi.commands.get("laoshi-duckdb-reset")?.handler("", pi.commandContext);
      expect(pi.notifications.at(-1)).toMatchObject({ level: "warning" });

      await pi.commands.get("laoshi-duckdb-reset")?.handler("--confirm", pi.commandContext);
      expect(pi.notifications.at(-1)).toMatchObject({ level: "info" });
      expect(closeSpy).toHaveBeenCalled();

      const profileTool = pi.tools.find((tool: RegisteredTool) => tool.name === "laoshi_get_profile");
      const profileResult = await profileTool.execute();
      expect(profileResult.details.vocabulary_counts).toHaveLength(0);
      expect(profileResult.details.settings).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: "pinyin_visibility", value: "hints-only" }),
      ]));
    } finally {
      closeSpy.mockRestore();
    }
  });

  it("supports explicit pull sync command and tool mode", async () => {
    const oldContainer = process.env.PI_LAOSHI_AZURE_CONTAINER;
    const oldConnection = process.env.AZURE_STORAGE_CONNECTION_STRING;
    try {
      process.env.PI_LAOSHI_AZURE_CONTAINER = "laoshi";
      process.env.AZURE_STORAGE_CONNECTION_STRING = "UseDevelopmentStorage=true";
      const pi = createMockPi();
      laoshiExtension(pi);

      await pi.commands.get("laoshi-sync")?.handler("pull", pi.commandContext);
      expect(pi.notifications.at(-1)).toMatchObject({ level: "warning" });
      expect(pi.notifications.at(-1)?.message).toContain("no-remote");

      const syncTool = pi.tools.find((tool: RegisteredTool) => tool.name === "laoshi_sync_state");
      const toolResult = await syncTool.execute("tool-call", { direction: "pull" });
      expect(toolResult.content[0].text).toContain("no-remote");
    } finally {
      if (oldContainer === undefined) delete process.env.PI_LAOSHI_AZURE_CONTAINER;
      else process.env.PI_LAOSHI_AZURE_CONTAINER = oldContainer;
      if (oldConnection === undefined) delete process.env.AZURE_STORAGE_CONNECTION_STRING;
      else process.env.AZURE_STORAGE_CONNECTION_STRING = oldConnection;
    }
  });

  it("reports command errors without throwing and reconnects the database", async () => {
    const oldContainer = process.env.PI_LAOSHI_AZURE_CONTAINER;
    const oldConnection = process.env.AZURE_STORAGE_CONNECTION_STRING;
    const closeSpy = vi.spyOn(LaoshiDatabase.prototype, "close");
    const connectSpy = vi.spyOn(LaoshiDatabase.prototype, "connect");
    try {
      delete process.env.PI_LAOSHI_AZURE_CONTAINER;
      delete process.env.AZURE_STORAGE_CONNECTION_STRING;
      const pi = createMockPi();
      laoshiExtension(pi);
      await pi.commands.get("laoshi-sync")?.handler("", pi.commandContext);
      expect(pi.notifications.at(-1)).toMatchObject({ level: "error" });
      expect(pi.notifications.at(-1)?.message).toContain("Azure sync requires");
      expect(closeSpy).toHaveBeenCalled();
      expect(connectSpy).toHaveBeenCalled();
    } finally {
      closeSpy.mockRestore();
      connectSpy.mockRestore();
      if (oldContainer === undefined) delete process.env.PI_LAOSHI_AZURE_CONTAINER;
      else process.env.PI_LAOSHI_AZURE_CONTAINER = oldContainer;
      if (oldConnection === undefined) delete process.env.AZURE_STORAGE_CONNECTION_STRING;
      else process.env.AZURE_STORAGE_CONNECTION_STRING = oldConnection;
    }
  });

  it("executes settings and export tools against isolated state", async () => {
    const pi = createMockPi();
    laoshiExtension(pi);

    const updateSettings = pi.tools.find((tool: RegisteredTool) => tool.name === "laoshi_update_settings");
    await updateSettings.execute("tool-call", { settings: [{ key: "pinyin_visibility", value: "off" }] });

    const getSettings = pi.tools.find((tool: RegisteredTool) => tool.name === "laoshi_get_settings");
    const settingsResult = await getSettings.execute();
    expect(settingsResult.content[0].text).toContain("pinyin_visibility");
    expect(settingsResult.content[0].text).toContain("off");

    const exportState = pi.tools.find((tool: RegisteredTool) => tool.name === "laoshi_export_state");
    const exportResult = await exportState.execute("tool-call", {});
    expect(exportResult.details.archivePath).toContain(join(tempDir, "exports"));
  });
});
