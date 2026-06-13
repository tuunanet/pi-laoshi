import type { ActivityMetadata } from "./content.js";
import { DEFAULT_SETTINGS } from "./settings.js";

export interface CountRow {
  status: string;
  count: number | string;
}

export interface EvaluationAverageRow {
  dimension: string;
  average_score: number | string;
}

export interface SettingRow {
  key: string;
  value: string;
}

export interface LearnerProgressProfile {
  vocabulary_counts: CountRow[];
  due_reviews: unknown[];
  recent_vocabulary: unknown[];
  evaluation_averages: EvaluationAverageRow[];
  settings: SettingRow[];
}

export interface LearnerProgressEvaluation {
  inferred_level: "beginner" | "beginner-plus";
  strengths: string[];
  weaknesses: string[];
  review_recommendation: {
    should_review: boolean;
    due_count: number;
    suggested_size: number;
  };
  recommended_next_activities: ActivityMetadata[];
  profile: LearnerProgressProfile;
}

function settingValue(profile: LearnerProgressProfile, key: string): string {
  const setting = profile.settings.find((row) => row.key === key);
  return setting ? setting.value : DEFAULT_SETTINGS[key as keyof typeof DEFAULT_SETTINGS];
}

function countByStatus(profile: LearnerProgressProfile, status: string): number {
  const row = profile.vocabulary_counts.find((count) => count.status === status);
  return row ? Number(row.count) : 0;
}

function averageByDimension(profile: LearnerProgressProfile, dimension: string): number | undefined {
  const row = profile.evaluation_averages.find((average) => average.dimension === dimension);
  return row ? Number(row.average_score) : undefined;
}

function findActivity(activities: ActivityMetadata[], id: string): ActivityMetadata | undefined {
  return activities.find((activity) => activity.id === id);
}

function addActivity(recommendations: ActivityMetadata[], activities: ActivityMetadata[], id: string): void {
  const activity = findActivity(activities, id);
  if (activity && !recommendations.some((recommendation) => recommendation.id === id)) recommendations.push(activity);
}

export function evaluateLearnerProgress(
  profile: LearnerProgressProfile,
  activities: ActivityMetadata[],
): LearnerProgressEvaluation {
  const introduced = countByStatus(profile, "introduced");
  const practicing = countByStatus(profile, "practicing");
  const known = countByStatus(profile, "known");
  const mastered = countByStatus(profile, "mastered");
  const totalVocabulary = profile.vocabulary_counts.reduce((sum, row) => sum + Number(row.count), 0);
  const knownOrMastered = known + mastered;
  const dueCount = profile.due_reviews.length;
  const reviewSize = Number(settingValue(profile, "review_size"));

  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const recommendations: ActivityMetadata[] = [];

  if (totalVocabulary === 0) {
    strengths.push("Ready to start a structured beginner path");
    weaknesses.push("No recorded vocabulary yet");
  }

  if (knownOrMastered > 0) strengths.push(`${knownOrMastered} known/mastered vocabulary items`);
  if (totalVocabulary > 0 && introduced + practicing > knownOrMastered) {
    weaknesses.push("Vocabulary is mostly introduced or practicing, not yet known");
  }

  if (dueCount > 0) weaknesses.push(`${dueCount} vocabulary items are due for review`);

  for (const dimension of ["pinyin", "tones", "vocabulary", "grammar", "fluency", "comprehension"] as const) {
    const average = averageByDimension(profile, dimension);
    if (average !== undefined && average < 0.7) weaknesses.push(`Needs ${dimension} practice`);
    if (average !== undefined && average >= 0.85) strengths.push(`Strong ${dimension} performance`);
  }

  const pinyinAverage = averageByDimension(profile, "pinyin");
  const fluencyAverage = averageByDimension(profile, "fluency");

  if (totalVocabulary === 0 || (pinyinAverage !== undefined && pinyinAverage < 0.7)) addActivity(recommendations, activities, "pinyin-basics");
  if (totalVocabulary < 20) addActivity(recommendations, activities, "greetings-1");
  if (totalVocabulary < 30) addActivity(recommendations, activities, "numbers-1");
  if (totalVocabulary < 50 || (fluencyAverage !== undefined && fluencyAverage < 0.85)) addActivity(recommendations, activities, "introduce-yourself");
  if (knownOrMastered >= 40) addActivity(recommendations, activities, "measure-words-1");

  const inferredLevel = knownOrMastered >= 40 || totalVocabulary >= 60 ? "beginner-plus" : "beginner";
  const maxRecommendations = inferredLevel === "beginner-plus" ? 2 : 4;

  return {
    inferred_level: inferredLevel,
    strengths,
    weaknesses,
    review_recommendation: {
      should_review: dueCount >= Math.min(reviewSize, 5),
      due_count: dueCount,
      suggested_size: Math.min(dueCount, reviewSize),
    },
    recommended_next_activities: recommendations.slice(0, maxRecommendations),
    profile,
  };
}
