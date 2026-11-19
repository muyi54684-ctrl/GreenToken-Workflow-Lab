import { createHash, randomUUID } from "node:crypto";
import { generateContent, type GeminiCallObservation } from "@/lib/providers/gemini";
import { PROTOCOL_VERSION } from "@/lib/greentoken/contracts";
import type { CallRecord, GeminiReviewParameters, ReviewMode, ReviewPolicyConfig, ReviewRequest, WorkflowOutcome } from "@/lib/greentoken/contracts";
import { immutableCopy, planReview, traceIds, validateReviewRequest } from "@/lib/greentoken/reviewPolicy";
import policyConfig from "@/config/greentoken.review.json";

/** Server-only opt-in. A mode never implicitly enables integration. */
export function reviewIntegrationMode(): ReviewMode | "disabled" {
  if (process.env.GREENTOKEN_REVIEW_ENABLED !== "1") return "disabled";
  const mode = process.env.GREENTOKEN_REVIEW_MODE ?? "passthrough";
  if (mode !== "baseline" && mode !== "passthrough" && mode !== "optimized") throw new Error("invalid_review_mode");
  return mode;
}
export function createReviewRequest(args: {
  requestId: string; mode: ReviewMode; model: string; systemPrompt: string;
  userText: string; schema: GeminiReviewParameters["generationConfig"]["responseSchema"]; draft: unknown;
}): ReviewRequest {
  return {
    protocol_version: PROTOCOL_VERSION, experiment_id: null, pair_id: null,
    run_id: randomUUID(), request_id: args.requestId, call_id: null,
    task_type: "storyboard_review", mode: args.mode,
    draft_sha256: createHash("sha256").update(JSON.stringify(args.draft)).digest("hex"),
    parameters: { model: args.model, contents: [{ role: "user", parts: [{ text: args.userText }] }],
      systemInstruction: { parts: [{ text: args.systemPrompt }] },
      generationConfig: { responseMimeType: "application/json", responseSchema: args.schema, temperature: 0.7 } },
  };
}
export function newWorkflowOutcome(request: ReviewRequest): WorkflowOutcome {
  return { protocol_version: PROTOCOL_VERSION, ...traceIds(request), mode: request.mode,
    parse_status: "not_executed", structure_status: "not_checked", review_selected: false,
    final_source: "unavailable", final_status: "not_executed", fallback_reason: null, failure_reason: null };
}
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function map(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
const usageNames = ["promptTokenCount","candidatesTokenCount","thoughtsTokenCount","totalTokenCount",
  "cachedContentTokenCount","toolUsePromptTokenCount"] as const;
function usage(data: unknown): Record<string, number | null> | null {
  const source = map(data).usageMetadata;
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  // Do not serialize unknown provider metadata or arbitrary strings.
  return Object.fromEntries(usageNames.map(name => [name, count(map(source)[name])]));
}
function redactCredential<T>(value: T, credential: string): { value: T; changed: boolean } {
  let changed = false;
  function visit(item: unknown): unknown {
    if (typeof item === "string") {
      if (credential && item.includes(credential)) { changed = true; return item.split(credential).join("[REDACTED]"); }
      return item;
    }
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, visit(child)]));
    return item;
  }
  return { value: visit(value) as T, changed };
}

/** Credential getter and runtime callbacks are never copied into the protocol. */
export async function runGeminiReview(
  request: ReviewRequest,
  credential: () => string,
  runtime: { signal?: AbortSignal; observation: GeminiCallObservation;
    onRequestSucceeded?: () => void; onRecord?: (record: CallRecord) => void;
    metricSource?: "api_response" | "mock_fixture" },
  config: ReviewPolicyConfig = policyConfig as ReviewPolicyConfig,
): Promise<string> {
  validateReviewRequest(request);
  if (request.mode === "baseline") throw new Error("baseline_must_use_original_call_path");
  if (runtime.observation.stage !== "storyboard_review" || runtime.observation.context?.requestId !== request.request_id) {
    throw new Error("review_observation_identity_mismatch");
  }
  const record: CallRecord = {
    protocol_version: PROTOCOL_VERSION, ...traceIds(request), mode: request.mode, stage: "storyboard_review",
    metric_source: runtime.metricSource ?? "api_response",
    policy: null, actual_parameters: immutableCopy(request.parameters), parameter_changes: [],
    request_sent: false, call_index: null, request_status: "rejected", failure_kind: null,
    http_status: null, provider_outcome: null, response_model: null, finish_reason: null, usageMetadata: null,
    input_tokens: null, output_tokens: null, reasoning_tokens: null, total_tokens: null,
    latency_ms: null, latency_scope: "fetch_and_response_body", text_state: "unavailable", credential_redacted: false,
  };
  let key = "";
  try {
    record.policy = planReview(request, config);
    // Decisions can be tested offline, but optimized execution is intentionally
    // blocked in this release, regardless of env or config contents.
    if (request.mode === "optimized") {
      record.failure_kind = "optimized_execution_disabled_stage2";
      throw new Error(record.failure_kind);
    }
    const parameters = record.policy!.parameters;
    record.actual_parameters = parameters;
    record.parameter_changes = record.policy!.changes;
    key = credential();
    record.request_status = "failed";
    const raw = await generateContent({
      apiKey: key, model: parameters.model,
      contents: JSON.parse(JSON.stringify(parameters.contents)),
      systemInstruction: JSON.parse(JSON.stringify(parameters.systemInstruction)),
      generationConfig: JSON.parse(JSON.stringify(parameters.generationConfig)),
      signal: runtime.signal, observation: runtime.observation,
      onFinished: observed => {
        record.request_sent = true;
        record.call_id = typeof observed.call_id === "string" ? observed.call_id : null;
        record.call_index = count(observed.call_index);
        record.http_status = count(observed.http_status);
        record.provider_outcome = typeof observed.outcome === "string" ? observed.outcome : null;
        record.input_tokens = count(observed.input_tokens);
        record.output_tokens = count(observed.output_tokens);
        record.reasoning_tokens = count(observed.thoughts_tokens);
        record.total_tokens = count(observed.total_tokens);
        record.latency_ms = typeof observed.latency_ms === "number" && Number.isFinite(observed.latency_ms) ? observed.latency_ms : null;
      },
    });
    record.request_status = "succeeded";
    record.usageMetadata = usage(raw);
    record.response_model = typeof map(raw).modelVersion === "string" ? map(raw).modelVersion as string : null;
    const candidates = map(raw).candidates;
    const first = Array.isArray(candidates) ? map(candidates[0]) : {};
    record.finish_reason = typeof first.finishReason === "string" ? first.finishReason : null;
    runtime.onRequestSucceeded?.();
    // Same extraction semantics as the original callChatModel; no JSON parsing,
    // candidate selection, finishReason gate, or fallback is added here.
    try {
      const originalShape = raw as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = originalShape.candidates?.[0]?.content?.parts?.map(p => p.text).join("") ?? "";
      record.text_state = text ? "present" : "empty";
      return text;
    } catch (error) {
      record.text_state = "extraction_failed"; record.failure_kind = "text_extraction_failed";
      throw error;
    }
  } catch (error) {
    record.failure_kind ??= record.request_status === "rejected" ? "preflight_rejected" :
      map(error).name === "AbortError" ? "cancelled" : record.provider_outcome ?? "request_failed";
    throw error;
  } finally {
    // Snapshot is detached and immutable. Even provider-echoed credential text
    // in modelVersion cannot reach a serializable observation.
    try {
      const safe = redactCredential(record, key);
      safe.value.credential_redacted = safe.changed;
      runtime.onRecord?.(immutableCopy(safe.value));
    } catch { /* Observer failure never retries or changes the model result. */ }
    key = "";
  }
}

/** Schema-shape observation only. Does not mutate or approve/reject the result. */
export function observeStructure(value: unknown): "valid" | "invalid" {
  try {
    const sb = map(value);
    if (typeof sb.detectedStyle !== "string" || typeof sb.language !== "string" ||
        !Number.isInteger(sb.totalDurationSec) || !Array.isArray(sb.shots)) return "invalid";
    for (const item of sb.shots) {
      const shot = map(item);
      if (!Number.isInteger(shot.index) || !Number.isInteger(shot.durationSec)) return "invalid";
      if (["summary","veoPrompt","camera","composition","ambiance"].some(k => typeof shot[k] !== "string")) return "invalid";
      if (!Array.isArray(shot.dialogue) || shot.dialogue.some(d => typeof map(d).speaker !== "string" || typeof map(d).line !== "string")) return "invalid";
      if (!Array.isArray(shot.sfx) || shot.sfx.some(s => typeof s !== "string")) return "invalid";
      for (const name of ["subtitle","continuityHint"]) if (shot[name] !== undefined && typeof shot[name] !== "string") return "invalid";
      if (shot.referenceImageIndex !== undefined && !Number.isInteger(shot.referenceImageIndex)) return "invalid";
    }
    return "valid";
  } catch { return "invalid"; }
}
/** Local structured observation, not a durable experiment store or quality score. */
export function publishReviewObservation(record: CallRecord | undefined, outcome: WorkflowOutcome): void {
  try { console.info("[GreenToken Review] " + JSON.stringify({ record: record ?? null, outcome })); }
  catch { /* Telemetry cannot affect workflow behavior. */ }
}
