import { describe, expect, it } from "vitest";
import { toSimplifiedChinese, normalizeVocabInput } from "../src/simplified.js";

describe("Simplified Chinese normalization", () => {
  it("converts Traditional Chinese text to Simplified Chinese", () => {
    expect(toSimplifiedChinese("老師說：我愛學習中文，謝謝！"))
      .toBe("老师说：我爱学习中文，谢谢！");
  });

  it("preserves explicit traditional source when normalizing vocabulary", () => {
    expect(normalizeVocabInput({ simplified: "老師", pinyin: "lǎo shī" })).toEqual({
      simplified: "老师",
      traditional: "老師",
      pinyin: "lǎo shī",
    });
    expect(normalizeVocabInput({ simplified: "老师", traditional: "老師" })).toEqual({
      simplified: "老师",
      traditional: "老師",
    });
  });
});
