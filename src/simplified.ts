import { Converter } from "opencc-js";

const traditionalToSimplified = Converter({ from: "tw", to: "cn" });

export interface VocabLikeInput {
  simplified: string;
  traditional?: string;
}

export function toSimplifiedChinese(text: string): string {
  return traditionalToSimplified(text);
}

export function normalizeVocabInput<T extends VocabLikeInput>(input: T): T {
  const simplified = toSimplifiedChinese(input.simplified);
  const traditional = input.traditional ?? (simplified !== input.simplified ? input.simplified : undefined);
  return {
    ...input,
    simplified,
    ...(traditional ? { traditional } : {}),
  };
}
