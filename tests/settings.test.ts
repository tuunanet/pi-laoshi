import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, settingsToObject, validateSetting, validateSettings } from "../src/settings.js";

describe("learner settings validation", () => {
  it("normalizes and validates known settings", () => {
    expect(validateSetting({ key: "pinyin_visibility", value: " on " })).toEqual({ key: "pinyin_visibility", value: "on" });
    expect(validateSetting({ key: "review_size", value: "12" })).toEqual({ key: "review_size", value: "12" });
    expect(validateSetting({ key: "preferred_practice_domains", value: "daily-life, travel" })).toEqual({
      key: "preferred_practice_domains",
      value: "daily-life,travel",
    });
  });

  it("rejects unknown or invalid settings", () => {
    expect(() => validateSetting({ key: "unknown", value: "x" })).toThrow(/Unknown learner setting/);
    expect(() => validateSetting({ key: "pinyin_visibility", value: "sometimes" })).toThrow(/pinyin_visibility/);
    expect(() => validateSetting({ key: "english_assistance", value: "never" })).toThrow(/english_assistance/);
    expect(() => validateSetting({ key: "review_size", value: "abc" })).toThrow(/review_size/);
    expect(() => validateSetting({ key: "review_size", value: "0" })).toThrow(/review_size/);
    expect(() => validateSetting({ key: "review_size", value: "101" })).toThrow(/review_size/);
    expect(() => validateSetting({ key: "preferred_practice_domains", value: "daily;rm" })).toThrow(/preferred_practice_domains/);
  });

  it("validates batches and converts rows to an object", () => {
    expect(validateSettings([{ key: "english_assistance", value: "when-needed" }])).toEqual([
      { key: "english_assistance", value: "when-needed" },
    ]);
    expect(settingsToObject([{ key: "review_size", value: "8" }])).toEqual({ ...DEFAULT_SETTINGS, review_size: "8" });
  });
});
