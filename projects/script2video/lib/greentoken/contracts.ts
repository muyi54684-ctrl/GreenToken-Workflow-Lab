/** Serializable protocol only. Credentials and AbortSignal belong to runtime arguments. */
export const PROTOCOL_VERSION = "greentoken.review/v1" as const;
export type ReviewMode = "baseline" | "passthrough" | "optimized";
export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
export interface TraceIds {
  experiment_id: string | null;
  pair_id: string | null;
  run_id: string;
  request_id: string;
  /** Null until the existing Provider assigns its call ID. */
  call_id: string | null;
}
export interface Envelope extends TraceIds { protocol_version: typeof PROTOCOL_VERSION }
export interface GeminiReviewParameters {
  readonly model: string;
  readonly contents: readonly { readonly role: "user"; readonly parts: readonly { readonly text: string }[] }[];
  readonly systemInstruction: { readonly parts: readonly { readonly text: string }[] };
  readonly generationConfig: {
    readonly responseMimeType: "application/json";
    readonly responseSchema: Json;
    readonly temperature: 0.7;
    readonly maxOutputTokens?: number;
    readonly thinkingConfig?: { readonly thinkingLevel?: string; readonly thinkingBudget?: number };
  };
}
export interface ReviewRequest extends Envelope {
  task_type: "storyboard_review";
  mode: ReviewMode;
  draft_sha256: string;
  parameters: GeminiReviewParameters;
}
export type ParameterPath = "model" | "generationConfig.maxOutputTokens" |
  "generationConfig.thinkingConfig.thinkingLevel" | "generationConfig.thinkingConfig.thinkingBudget";
export interface ParameterChange {
  path: ParameterPath;
  before_present: boolean;
  before: string | number | null;
  after: string | number;
}
export interface PolicyDecision extends Envelope {
  mode: "passthrough" | "optimized";
  task_type: "storyboard_review";
  policy_id: string;
  policy_version: string;
  reason: string;
  changes: readonly ParameterChange[];
  parameters: GeminiReviewParameters;
}
export interface ReviewPolicyConfig {
  protocol_version: typeof PROTOCOL_VERSION;
  policy_id: string;
  policy_version: string;
  reason: string;
  /** Explicit, reviewed capabilities. No inferred capability from a model name. */
  capabilities: Record<string, {
    maxOutputTokens?: { min: number; max: number };
    thinkingLevels?: string[];
    thinkingBudget?: { min: number; max: number };
  }>;
  optimized: { model?: string; maxOutputTokens?: number; thinkingLevel?: string; thinkingBudget?: number };
}
export interface CallRecord extends Envelope {
  metric_source: "api_response" | "mock_fixture";
  mode: ReviewMode;
  stage: "storyboard_review";
  policy: PolicyDecision | null;
  actual_parameters: GeminiReviewParameters;
  parameter_changes: readonly ParameterChange[];
  request_sent: boolean;
  call_index: number | null;
  request_status: "succeeded" | "failed" | "rejected";
  failure_kind: string | null;
  http_status: number | null;
  provider_outcome: string | null;
  response_model: string | null;
  finish_reason: string | null;
  /** Allowlisted numeric usageMetadata fields. Missing/invalid values are null. */
  usageMetadata: Record<string, number | null> | null;
  input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  total_tokens: number | null;
  latency_ms: number | null;
  latency_scope: "fetch_and_response_body";
  text_state: "present" | "empty" | "unavailable" | "extraction_failed";
  credential_redacted: boolean;
}
export interface WorkflowOutcome extends Envelope {
  mode: ReviewMode;
  parse_status: "not_executed" | "succeeded" | "failed";
  /** Observation only; never an acceptance gate. */
  structure_status: "not_checked" | "valid" | "invalid";
  review_selected: boolean;
  final_source: "draft" | "review" | "unavailable";
  final_status: "not_executed" | "succeeded" | "failed";
  fallback_reason: string | null;
  failure_reason: string | null;
}
export interface QualityAssessment extends Envelope {
  mode: ReviewMode;
  rubric_version: string;
  status: "pending" | "evaluated";
  completion: "pending" | "completed" | "partial" | "failed";
  score: number | null;
  notes: string;
}
