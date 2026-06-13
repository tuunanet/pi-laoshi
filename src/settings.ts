export interface LearnerSettingInput {
  key: string;
  value: string;
}

export const DEFAULT_SETTINGS = {
  pinyin_visibility: "hints-only",
  english_assistance: "when-needed",
  review_size: "10",
  preferred_practice_domains: "daily-life,greetings,numbers",
} as const satisfies Record<string, string>;

export type LearnerSettingKey = keyof typeof DEFAULT_SETTINGS;

const PINYIN_VISIBILITY = new Set(["on", "off", "hints-only"]);
const ENGLISH_ASSISTANCE = new Set(["when-needed", "minimal", "always", "requested-only"]);

function normalizeCsv(value: string): string {
  return value
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .join(",");
}

export function validateSetting(input: LearnerSettingInput): LearnerSettingInput {
  const key = input.key.trim() as LearnerSettingKey;
  const rawValue = input.value.trim();

  if (!Object.hasOwn(DEFAULT_SETTINGS, key)) {
    throw new Error(`Unknown learner setting: ${input.key}`);
  }

  switch (key) {
    case "pinyin_visibility": {
      if (!PINYIN_VISIBILITY.has(rawValue)) throw new Error("pinyin_visibility must be on, off, or hints-only");
      return { key, value: rawValue };
    }
    case "english_assistance": {
      if (!ENGLISH_ASSISTANCE.has(rawValue)) {
        throw new Error("english_assistance must be when-needed, minimal, always, or requested-only");
      }
      return { key, value: rawValue };
    }
    case "review_size": {
      if (!/^\d+$/u.test(rawValue)) throw new Error("review_size must be an integer from 1 to 100");
      const size = Number(rawValue);
      if (size < 1 || size > 100) throw new Error("review_size must be an integer from 1 to 100");
      return { key, value: String(size) };
    }
    case "preferred_practice_domains": {
      const value = normalizeCsv(rawValue);
      if (!value || !/^[a-z0-9-]+(,[a-z0-9-]+)*$/u.test(value)) {
        throw new Error("preferred_practice_domains must be a comma-separated list of lowercase words/slugs");
      }
      return { key, value };
    }
  }
}

export function validateSettings(settings: LearnerSettingInput[]): LearnerSettingInput[] {
  return settings.map(validateSetting);
}

export function settingsToObject(settings: LearnerSettingInput[]): Record<LearnerSettingKey, string> {
  return { ...DEFAULT_SETTINGS, ...Object.fromEntries(validateSettings(settings).map((setting) => [setting.key, setting.value])) };
}
