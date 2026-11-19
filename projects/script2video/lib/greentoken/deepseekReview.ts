import type { Storyboard } from "@/lib/types";
import type { ReviewMode } from "@/lib/greentoken/contracts";
import { fields, assertSafe, canonical, clone } from "@/lib/greentoken/experimentData";
import { immutableCopy } from "@/lib/greentoken/reviewPolicy";
import { buildStoryboardReviewPrompt, STORYBOARD_REVIEW_SYSTEM_PROMPT } from "@/lib/prompts/storyboard";
import evidence from "@/config/deepseek.experiment-evidence.json";

export const DEEPSEEK_PROTOCOL = "greentoken.deepseek-review/v1" as const;
export const POLICY = { id: "deepseek-review-effort-only", version: "1.0.0",
  reason: "Only set reasoning_effort=low; preserve original Review input and defaults." } as const;
export interface DeepSeekParameters {
  model: "deepseek-v4-pro";
  messages: { role: "system" | "user"; content: string }[];
  temperature: 0.7;
  response_format: { type: "json_object" };
  stream: false;
  reasoning_effort?: "low";
}
export interface Constraints { durationSec: number; allowedDurations: number[]; language: string | null; withSubtitle: boolean; aspectRatio: "16:9" | "9:16" }
export function validateParameters(p: DeepSeekParameters): void {
  assertSafe(p);
  fields(p, ["model", "messages", "temperature", "response_format", "stream", "reasoning_effort"]);
  fields(p.response_format, ["type"]);
  if (p.model !== evidence.model || p.temperature !== 0.7 || p.stream !== false || p.response_format.type !== "json_object" ||
      !Array.isArray(p.messages) || p.messages.length !== 2) throw Error("invalid_deepseek_parameters");
  p.messages.forEach((m, i) => {
    fields(m, ["role", "content"]);
    if (m.role !== (i === 0 ? "system" : "user") || typeof m.content !== "string" || !m.content.trim()) throw Error("invalid_review_messages");
  });
  if (Object.prototype.hasOwnProperty.call(p, "reasoning_effort") && (p.reasoning_effort !== "low" || !evidence.supported_efforts.includes(p.reasoning_effort))) throw Error("unsupported_experiment_effort");
}
export function buildBaseline(draft: Storyboard, c: Constraints): DeepSeekParameters {
  const p: DeepSeekParameters = { model: "deepseek-v4-pro", messages: [
    { role: "system", content: STORYBOARD_REVIEW_SYSTEM_PROMPT },
    { role: "user", content: buildStoryboardReviewPrompt({ storyboard: draft, allowedDurations: c.allowedDurations,
      maxDurationSec: c.durationSec, language: c.language ?? undefined, withSubtitle: c.withSubtitle }) }
  ], temperature: 0.7, response_format: { type: "json_object" }, stream: false };
  validateParameters(p); return immutableCopy(p);
}
export function decideDeepSeek(mode: Exclude<ReviewMode, "baseline">, baseline: DeepSeekParameters) {
  validateParameters(baseline);
  if (Object.prototype.hasOwnProperty.call(baseline, "reasoning_effort")) throw Error("baseline_effort_must_be_omitted");
  if (mode !== "passthrough" && mode !== "optimized") throw Error("baseline_must_bypass_policy");
  const parameters = clone(baseline);
  const changes = mode === "optimized" ? [{ path: "reasoning_effort", before_present: false, before: null, after: "low" }] : [];
  if (mode === "optimized") parameters.reasoning_effort = "low";
  validateParameters(parameters);
  return immutableCopy({ policy_id: POLICY.id, policy_version: POLICY.version,
    reason: mode === "passthrough" ? "Preserve the baseline request unchanged." : POLICY.reason, changes, parameters });
}
/** Baseline never invokes the decision function, including an injected throwing one. */
export function planDeepSeek(mode: ReviewMode, baseline: DeepSeekParameters, decide = decideDeepSeek) {
  validateParameters(baseline);
  if (Object.prototype.hasOwnProperty.call(baseline, "reasoning_effort")) throw Error("baseline_effort_must_be_omitted");
  return mode === "baseline" ? null : decide(mode, baseline);
}
export function assertOnlyEffort(baseline: DeepSeekParameters, optimized: DeepSeekParameters): void {
  validateParameters(baseline); validateParameters(optimized);
  if (Object.prototype.hasOwnProperty.call(baseline, "reasoning_effort") || canonical({ ...baseline, reasoning_effort: "low" }) !== canonical(optimized)) throw Error("non_experimental_variable_changed");
}
