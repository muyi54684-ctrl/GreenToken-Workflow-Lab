import { PROTOCOL_VERSION } from "@/lib/greentoken/contracts";
import type { GeminiReviewParameters, ParameterChange, PolicyDecision, ReviewPolicyConfig, ReviewRequest, TraceIds } from "@/lib/greentoken/contracts";

function object(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_object");
}
function keys(value: unknown, allowed: readonly string[]): asserts value is Record<string, unknown> {
  object(value);
  if (Object.keys(value).some(k => !allowed.includes(k))) throw new Error("parameter_not_allowlisted");
}
function text(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error("invalid_text");
}
function jsonOnly(value: unknown): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) { value.forEach(jsonOnly); return; }
  object(value);
  for (const [key, child] of Object.entries(value)) {
    if (/^(api_?key|authorization|cookie|headers|x-goog-api-key)$/i.test(key)) throw new Error("credential_field_forbidden");
    jsonOnly(child);
  }
}
export function traceIds(request: TraceIds): TraceIds {
  return { experiment_id: request.experiment_id, pair_id: request.pair_id,
    run_id: request.run_id, request_id: request.request_id, call_id: request.call_id };
}
export function immutableCopy<T>(value: T): T {
  const copy = JSON.parse(JSON.stringify(value)) as T;
  function freeze(item: unknown): void {
    if (item && typeof item === "object") { Object.values(item).forEach(freeze); Object.freeze(item); }
  }
  freeze(copy);
  return copy;
}
export function validateReviewRequest(request: ReviewRequest): void {
  keys(request, ["protocol_version","experiment_id","pair_id","run_id","request_id","call_id","task_type","mode","draft_sha256","parameters"]);
  jsonOnly(request);
  if (request.protocol_version !== PROTOCOL_VERSION || request.task_type !== "storyboard_review") throw new Error("invalid_review_protocol");
  if (!["baseline","passthrough","optimized"].includes(request.mode)) throw new Error("invalid_review_mode");
  for (const k of ["run_id","request_id","draft_sha256"] as const) text(request[k]);
  for (const k of ["experiment_id","pair_id","call_id"] as const) if (request[k] !== null) text(request[k]);
  const p = request.parameters;
  keys(p, ["model","contents","systemInstruction","generationConfig"]);
  text(p.model);
  if (!/^(models\/)?gemini-[a-zA-Z0-9._-]+$/.test(p.model)) throw new Error("non_gemini_model");
  if (!Array.isArray(p.contents) || p.contents.length !== 1) throw new Error("review_contents_invalid");
  keys(p.contents[0], ["role","parts"]);
  if (p.contents[0].role !== "user") throw new Error("review_role_invalid");
  for (const container of [p.contents[0], p.systemInstruction]) {
    if (container === p.systemInstruction) keys(container, ["parts"]);
    if (!Array.isArray(container.parts) || container.parts.length !== 1) throw new Error("review_parts_invalid");
    keys(container.parts[0], ["text"]); text(container.parts[0].text);
  }
  keys(p.generationConfig, ["responseMimeType","responseSchema","temperature","maxOutputTokens","thinkingConfig"]);
  if (p.generationConfig.temperature !== 0.7 || p.generationConfig.responseMimeType !== "application/json") throw new Error("protected_generation_config");
  object(p.generationConfig.responseSchema);
  if (p.generationConfig.maxOutputTokens !== undefined &&
      (!Number.isSafeInteger(p.generationConfig.maxOutputTokens) || p.generationConfig.maxOutputTokens < 1)) throw new Error("invalid_output_budget");
  if (p.generationConfig.thinkingConfig !== undefined) {
    const thinking = p.generationConfig.thinkingConfig;
    keys(thinking, ["thinkingLevel","thinkingBudget"]);
    if (thinking.thinkingLevel !== undefined) text(thinking.thinkingLevel);
    if (thinking.thinkingBudget !== undefined && (!Number.isSafeInteger(thinking.thinkingBudget) || thinking.thinkingBudget < 0)) throw new Error("invalid_thinking_budget");
    if (thinking.thinkingLevel !== undefined && thinking.thinkingBudget !== undefined) throw new Error("conflicting_thinking_controls");
  }
}
function range(value: unknown, limits: { min: number; max: number } | undefined): void {
  if (!limits || !Number.isSafeInteger(value) || (value as number) < limits.min || (value as number) > limits.max) throw new Error("unsupported_parameter_value");
}
function validateConfig(config: ReviewPolicyConfig): void {
  keys(config, ["protocol_version","policy_id","policy_version","reason","capabilities","optimized"]);
  jsonOnly(config);
  if (config.protocol_version !== PROTOCOL_VERSION) throw new Error("invalid_policy_protocol");
  [config.policy_id,config.policy_version,config.reason].forEach(text);
  keys(config.optimized, ["model","maxOutputTokens","thinkingLevel","thinkingBudget"]);
  object(config.capabilities);
  for (const [model, caps] of Object.entries(config.capabilities)) {
    if (!/^gemini-[a-zA-Z0-9._-]+$/.test(model)) throw new Error("capability_model_must_be_canonical");
    keys(caps, ["maxOutputTokens","thinkingLevels","thinkingBudget"]);
    for (const name of ["maxOutputTokens","thinkingBudget"] as const) {
      const limit = caps[name];
      if (limit !== undefined) {
        keys(limit, ["min","max"]);
        if (!Number.isSafeInteger(limit.min) || !Number.isSafeInteger(limit.max) || limit.min < 0 || limit.max < limit.min ||
            (name === "maxOutputTokens" && limit.min < 1)) throw new Error("invalid_capability_range");
      }
    }
    if (caps.thinkingLevels !== undefined && (!Array.isArray(caps.thinkingLevels) ||
        !caps.thinkingLevels.length || caps.thinkingLevels.some(v => typeof v !== "string" || !v.trim()))) throw new Error("invalid_thinking_levels");
  }
}
export function decideReview(request: ReviewRequest, config?: ReviewPolicyConfig): PolicyDecision {
  validateReviewRequest(request);
  if (request.mode === "baseline") throw new Error("baseline_must_bypass_policy");
  const ids = { protocol_version: PROTOCOL_VERSION, ...traceIds(request) };
  if (request.mode === "passthrough") return immutableCopy({
    ...ids, mode: "passthrough", task_type: "storyboard_review", policy_id: "review-passthrough",
    policy_version: "1.0.0", reason: "Preserve the original Gemini Review request unchanged.",
    changes: [], parameters: request.parameters,
  });
  if (!config) throw new Error("explicit_policy_config_required");
  validateConfig(config);
  const change = config.optimized;
  const parameters = JSON.parse(JSON.stringify(request.parameters)) as {
    model: string; contents: GeminiReviewParameters["contents"]; systemInstruction: GeminiReviewParameters["systemInstruction"];
    generationConfig: { responseMimeType: "application/json"; responseSchema: GeminiReviewParameters["generationConfig"]["responseSchema"];
      temperature: 0.7; maxOutputTokens?: number; thinkingConfig?: { thinkingLevel?: string; thinkingBudget?: number } };
  };
  const model = change.model ?? parameters.model;
  if (!/^(models\/)?gemini-[a-zA-Z0-9._-]+$/.test(model)) throw new Error("non_gemini_model");
  const caps = config.capabilities[model.replace(/^models\//, "")];
  if (!caps) throw new Error("model_capabilities_unconfirmed");
  const changes: ParameterChange[] = [];
  function diff(path: ParameterChange["path"], before: string | number | undefined, after: string | number) {
    if (before !== after) changes.push({ path, before_present: before !== undefined, before: before ?? null, after });
  }
  diff("model", parameters.model, model); parameters.model = model;
  const gen = parameters.generationConfig;
  if (change.maxOutputTokens !== undefined) {
    range(change.maxOutputTokens, caps.maxOutputTokens);
    diff("generationConfig.maxOutputTokens", gen.maxOutputTokens, change.maxOutputTokens);
    gen.maxOutputTokens = change.maxOutputTokens;
  }
  if (change.thinkingLevel !== undefined && change.thinkingBudget !== undefined) throw new Error("conflicting_thinking_controls");
  if (change.thinkingLevel !== undefined) {
    if (!caps.thinkingLevels?.includes(change.thinkingLevel) || gen.thinkingConfig?.thinkingBudget !== undefined) throw new Error("unsupported_thinking_level");
    diff("generationConfig.thinkingConfig.thinkingLevel", gen.thinkingConfig?.thinkingLevel, change.thinkingLevel);
    gen.thinkingConfig = { ...gen.thinkingConfig, thinkingLevel: change.thinkingLevel };
  }
  if (change.thinkingBudget !== undefined) {
    range(change.thinkingBudget, caps.thinkingBudget);
    if (gen.thinkingConfig?.thinkingLevel !== undefined) throw new Error("conflicting_thinking_controls");
    diff("generationConfig.thinkingConfig.thinkingBudget", gen.thinkingConfig?.thinkingBudget, change.thinkingBudget);
    gen.thinkingConfig = { ...gen.thinkingConfig, thinkingBudget: change.thinkingBudget };
  }
  // Validate inherited parameters too: changing model cannot retain unsupported settings.
  if (gen.maxOutputTokens !== undefined) range(gen.maxOutputTokens, caps.maxOutputTokens);
  if (gen.thinkingConfig?.thinkingLevel !== undefined && !caps.thinkingLevels?.includes(gen.thinkingConfig.thinkingLevel)) throw new Error("unsupported_thinking_level");
  if (gen.thinkingConfig?.thinkingBudget !== undefined) range(gen.thinkingConfig.thinkingBudget, caps.thinkingBudget);
  return immutableCopy({ ...ids, mode: "optimized", task_type: "storyboard_review", policy_id: config.policy_id,
    policy_version: config.policy_version, reason: config.reason, changes, parameters });
}
/** Baseline never calls the decision function, including an injected failing one. */
export function planReview(request: ReviewRequest, config?: ReviewPolicyConfig, decide = decideReview): PolicyDecision | null {
  if (request.mode === "baseline") return null;
  return decide(request, config);
}
