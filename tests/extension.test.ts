import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import laoshiExtension from "../extensions/laoshi/index.js";

interface RegisteredTool {
  name: string;
  execute: (...args: any[]) => Promise<any>;
}

let tempDir: string;
let oldDbPath: string | undefined;
let oldStateDir: string | undefined;

function createMockPi() {
  const handlers = new Map<string, Function[]>();
  const tools: RegisteredTool[] = [];
  const commands = new Map<string, unknown>();
  return {
    handlers,
    tools,
    commands,
    on(name: string, handler: Function) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
    registerTool(tool: RegisteredTool) {
      tools.push(tool);
    },
    registerCommand(name: string, command: unknown) {
      commands.set(name, command);
    },
    sendUserMessage() {},
  } as any;
}

beforeEach(async () => {
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
