import { randomUUID } from "node:crypto";
import type { DeepSeekParameters } from "@/lib/greentoken/deepseekReview";
import { validateParameters } from "@/lib/greentoken/deepseekReview";
import { numberOrNull, objectOrEmpty, sanitize, clone } from "@/lib/greentoken/experimentData";

export function endpoint(baseUrl = "https://api.deepseek.com"): string {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw Error("invalid_deepseek_base_url");
  return url.href.replace(/\/+$/, "") + "/chat/completions";
}
export function parseDeepSeekUsage(raw: unknown) {
  const u = objectOrEmpty(raw), details = objectOrEmpty(u.completion_tokens_details);
  const input = numberOrNull(u.prompt_tokens), output = numberOrNull(u.completion_tokens), total = numberOrNull(u.total_tokens);
  const nested = numberOrNull(details.reasoning_tokens), legacy = numberOrNull(u.reasoning_tokens);
  let reasoning = Object.prototype.hasOwnProperty.call(details, "reasoning_tokens") ? nested : legacy;
  let status = reasoning === null ? "unavailable" : "available";
  if ((Object.prototype.hasOwnProperty.call(details, "reasoning_tokens") && Object.prototype.hasOwnProperty.call(u, "reasoning_tokens") && details.reasoning_tokens !== u.reasoning_tokens) ||
      (reasoning !== null && output !== null && reasoning > output)) { reasoning = null; status = "inconsistent"; }
  return { input_tokens: input, output_tokens: output, reasoning_tokens: reasoning, total_tokens: total,
    reasoning_status: status, output_includes_reasoning: true,
    totals_consistent: input !== null && output !== null && total !== null ? input + output === total : null };
}
export interface DeepSeekRuntime {
  baseUrl?: string; signal?: AbortSignal; timeoutMs?: number;
  /** Runtime-only dependency injection; never serialized. */
  transport?: typeof fetch; credential?: () => string; callId?: string;
  /** Only an explicitly authorized caller may enable the native transport. */
  allowLive?: boolean;
  /** Opt-in private audit capture; sanitized before returning, including HTTP failures. */
  captureRawResponse?: boolean;
}
/** One POST, no retry, no provider/model fallback. Result objects never contain credentials or raw errors. */
export async function generateContent(parameters: DeepSeekParameters, runtime: DeepSeekRuntime = {}) {
  let wireStarted: number | null = null;
  const result = { call_id: runtime.callId ?? randomUUID(), request_sent: false, http_status: null as number | null,
    request_succeeded: false, failure_kind: null as string | null, text: null as string | null,
    text_state: "unavailable", raw_usage: null as unknown, ...parseDeepSeekUsage(null), finish_reason: null as string | null,
    model: null as string | null, system_fingerprint: null as string | null, response_id: null as string | null,
    latency_ms: null as number | null, latency_scope: "fetch_and_response_body", response_redacted: false,
    raw_response_body: null as string | null, raw_response_redacted: false,
    total_timeout_ms: null as number | null, headers_received_ms: null as number | null,
    first_body_byte_ms: null as number | null, last_body_byte_ms: null as number | null,
    body_bytes_received: null as number | null, body_chunks_received: null as number | null,
    body_complete: false, failure_stage: null as string | null, abort_origin: null as string | null };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController(); let timedOut = false;
  let key = "", rawText = "", phase = "preflight";
  const decoder = new TextDecoder();
  const abort = () => controller.abort();
  try {
    validateParameters(parameters);
    const url = endpoint(runtime.baseUrl);
    if (!runtime.transport && runtime.allowLive !== true) { result.failure_kind = "live_execution_not_authorized"; return result; }
    const timeout = runtime.timeoutMs ?? 120000;
    if (!Number.isSafeInteger(timeout) || timeout < 1) throw Error("invalid_timeout");
    result.total_timeout_ms = timeout;
    if (runtime.signal?.aborted) { result.failure_kind = "cancelled"; return result; }
    // Offline transports MUST supply a fake getter; never read environment credentials in tests.
    if (runtime.transport && !runtime.credential) { result.failure_kind = "offline_credential_required"; return result; }
    key = runtime.credential ? runtime.credential() : process.env.DEEPSEEK_API_KEY ?? "";
    if (!key.trim()) { result.failure_kind = "credential_missing"; return result; }
    // Protect frozen inputs too: a key echoed into a prompt cannot become a persisted request.
    if (JSON.stringify(parameters).includes(key)) { result.failure_kind = "credential_in_request"; return result; }
    const body = JSON.stringify(clone(parameters));
    runtime.signal?.addEventListener("abort", abort, { once: true });
    if (runtime.signal?.aborted) { result.failure_kind = "cancelled"; return result; }
    timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
    wireStarted = performance.now();
    phase = "request";
    result.request_sent = true;
    const response = await (runtime.transport ?? fetch)(url, { method: "POST", headers: {
      Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body, signal: controller.signal,
      cache: "no-store", redirect: "error" });
    result.http_status = response.status;
    result.headers_received_ms = performance.now() - wireStarted;
    result.body_bytes_received = 0; result.body_chunks_received = 0;
    phase = "response_body";
    // HTTP chunk reading only: the model request remains stream:false. Never parse a prefix.
    const reader = response.body?.getReader();
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          result.body_chunks_received++;
          result.body_bytes_received += value.byteLength;
          if (value.byteLength) {
            const elapsed = performance.now() - wireStarted;
            result.first_body_byte_ms ??= elapsed; result.last_body_byte_ms = elapsed;
          }
          rawText += decoder.decode(value, { stream: true });
        }
      } finally { reader.releaseLock(); }
    }
    // A cancelled read must not be treated as complete even if its stream closes gracefully.
    if (controller.signal.aborted) throw Error("body_read_aborted");
    rawText += decoder.decode();
    result.body_complete = true;
    result.latency_ms = performance.now() - wireStarted;
    phase = "response_status";
    if (!response.ok) { result.failure_kind = "http_error"; return result; }
    phase = "response_json";
    let raw: unknown;
    try { raw = JSON.parse(rawText); } catch { result.failure_kind = "invalid_response_json"; return result; }
    const safe = sanitize(raw, key); result.response_redacted = safe.redacted;
    const data = objectOrEmpty(safe.value);
    result.raw_usage = data.usage ?? null;
    Object.assign(result, parseDeepSeekUsage(result.raw_usage));
    for (const [target, source] of [["model", "model"], ["system_fingerprint", "system_fingerprint"], ["response_id", "id"]] as const)
      result[target] = typeof data[source] === "string" ? data[source] as string : null;
    const choices = data.choices;
    const choice = objectOrEmpty(Array.isArray(choices) ? choices[0] : null), message = objectOrEmpty(choice.message);
    result.finish_reason = typeof choice.finish_reason === "string" ? choice.finish_reason : null;
    phase = "response_structure";
    if (!Array.isArray(choices) || !choices.length || (message.content !== null && typeof message.content !== "string")) {
      result.failure_kind = "invalid_response_structure"; return result;
    }
    result.request_succeeded = true;
    phase = "response_text";
    if (safe.redacted) { result.failure_kind = "sensitive_response_redacted"; return result; }
    result.text = typeof message.content === "string" ? message.content : "";
    result.text_state = result.text.trim() ? "present" : "empty";
    // Keep exact text. Whitespace follows the original parser/fallback path, not a new acceptance rule.
    if (!result.text.trim()) result.failure_kind = "empty_text";
    return result;
  } catch {
    result.failure_kind = timedOut ? "timeout" : runtime.signal?.aborted ? "cancelled" : result.request_sent ? "network_error" : "request_rejected";
    return result;
  } finally {
    if (timer) clearTimeout(timer);
    runtime.signal?.removeEventListener("abort", abort);
    if (wireStarted !== null && result.latency_ms === null) result.latency_ms = performance.now() - wireStarted;
    if (result.failure_kind !== null) result.failure_stage = phase;
    result.abort_origin = timedOut ? "total_timeout" : runtime.signal?.aborted ? "caller" : null;
    if (runtime.captureRawResponse && result.http_status !== null) {
      // Scrub the assembled body, including credentials split across chunks, before any persistence.
      // This is best-effort capture on return, not a crash-safe streaming journal.
      if (!result.body_complete) rawText += decoder.decode();
      const capture = sanitize(rawText, key);
      result.raw_response_body = capture.value;
      result.raw_response_redacted = capture.redacted;
    }
  }
}
