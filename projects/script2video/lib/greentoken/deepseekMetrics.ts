import evidence from "@/config/deepseek.experiment-evidence.json";
import { objectOrEmpty, numberOrNull } from "@/lib/greentoken/experimentData";
import { parseDeepSeekUsage } from "@/lib/providers/deepseek";

/** Fixed peak reference for comparable experiments; not an actual account charge. */
export function deepSeekCost(model: string | null, raw: unknown) {
  const pricing = evidence.pricing, u = objectOrEmpty(raw), t = parseDeepSeekUsage(raw);
  const result = { reference_cost_usd: null as number | null, currency: pricing.currency, price_version: pricing.version,
    price_source: pricing.price_source, price_checked_at: pricing.checked_at, pricing_policy: pricing.policy,
    unavailable_reason: null as string | null, cached_input_tokens: null as number | null, uncached_input_tokens: null as number | null };
  const unavailable = (reason: string) => ({ ...result, unavailable_reason: reason });
  if (model === null) return unavailable("missing_response_model");
  if (model !== pricing.model) return unavailable("price_model_mismatch");
  if (t.input_tokens === null || t.output_tokens === null || t.total_tokens === null) return unavailable("missing_usage");
  if (t.totals_consistent !== true || t.reasoning_status === "inconsistent") return unavailable("inconsistent_usage");
  const details = objectOrEmpty(u.prompt_tokens_details);
  const hit = numberOrNull(Object.prototype.hasOwnProperty.call(u, "prompt_cache_hit_tokens") ? u.prompt_cache_hit_tokens : details.cached_tokens);
  const miss = numberOrNull(u.prompt_cache_miss_tokens);
  if (hit === null || miss === null) return unavailable("cache_usage_missing");
  if (Object.prototype.hasOwnProperty.call(details, "cached_tokens") && numberOrNull(details.cached_tokens) !== hit) return unavailable("conflicting_cache_usage");
  if (hit + miss !== t.input_tokens) return unavailable("invalid_cache_breakdown");
  result.cached_input_tokens = hit; result.uncached_input_tokens = miss;
  // Integer USD micro-units per million tokens: avoid adding reasoning twice.
  const p = pricing.peak;
  const units = BigInt(hit) * BigInt(Math.round(p.input_cached_per_million * 1e6)) +
    BigInt(miss) * BigInt(Math.round(p.input_uncached_per_million * 1e6)) + BigInt(t.output_tokens) * BigInt(Math.round(p.output_per_million * 1e6));
  result.reference_cost_usd = Number(units) / 1e12;
  return result;
}
