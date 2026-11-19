import { createHash } from "node:crypto";

export const EXPERIMENT_VERSION = "greentoken.review.experiment/v1" as const;
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical((value as Record<string, unknown>)[k])).join(",") + "}";
}
export function hash(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
export function textHash(text: string): string { return createHash("sha256").update(text).digest("hex"); }
export function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
export function fields(value: unknown, allowed: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) throw new Error("unknown_or_invalid_fields");
}
export function requireText(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error("text_required");
}
const secretField = /^(api[_-]?key|authorization|cookie|headers|x-goog-api-key|access[_-]?token|password|secret)$/i;
const secretText = /AIza[\w-]{20,}|Bearer\s+\S+|(?:api[_-]?key|authorization)\s*[:=]\s*\S+/i;
/** Reject credential-shaped input before any filesystem writes. Content must also be human-sanitized. */
export function assertSafe(value: unknown): void {
  if (typeof value === "string") { if (secretText.test(value)) throw new Error("sensitive_input_forbidden"); return; }
  if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return;
  if (Array.isArray(value)) { value.forEach(assertSafe); return; }
  if (!value || typeof value !== "object") throw new Error("non_json_value");
  for (const [key, item] of Object.entries(value)) {
    if (secretField.test(key) || key === "__proto__") throw new Error("credential_field_forbidden");
    assertSafe(item);
  }
}
/** Persist response content after credential scrubbing, never persist headers or raw errors. */
export function sanitize<T>(value: T, credential: string): { value: T; redacted: boolean } {
  let redacted = false;
  function visit(v: unknown): unknown {
    if (typeof v === "string") {
      if ((credential && v.includes(credential)) || secretText.test(v)) { redacted = true; return "[REDACTED]"; }
      return v;
    }
    if (Array.isArray(v)) return v.map(visit);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, child]) => {
      if (secretField.test(k) || (credential && k.includes(credential))) { redacted = true; return ["redacted_field", "[REDACTED]"]; }
      return [k, visit(child)];
    }));
    return v ?? null;
  }
  return { value: visit(value) as T, redacted };
}
export function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
export function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
