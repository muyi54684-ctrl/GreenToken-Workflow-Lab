import type { GeminiModel } from "@/lib/types";
import { randomUUID } from "node:crypto";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

function headers(apiKey: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    "x-goog-api-key": apiKey,
  };
}

export async function listModels(apiKey: string): Promise<GeminiModel[]> {
  const all: GeminiModel[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${BASE}/models`);
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, { headers: headers(apiKey), cache: "no-store" });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`listModels ${res.status}: ${text}`);
    }
    const data = (await res.json()) as { models?: GeminiModel[]; nextPageToken?: string };
    if (data.models) all.push(...data.models);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return all;
}

export interface GeminiCallContext {
  requestId: string;
  callCount: number;
}

export interface GeminiCallObservation {
  stage: "storyboard_generation" | "storyboard_review" | "storyboard_local_patch_review" | "image_generation" | "generate_content";
  context?: GeminiCallContext;
}

function logGeminiCall(record: Record<string, unknown>): void {
  try {
    console.info(`[Gemini Call] ${JSON.stringify(record)}`);
  } catch {
    // Observability must never change the result of a provider call.
  }
}

function usageFields(data: unknown) {
  const usage = data !== null && typeof data === "object" && "usageMetadata" in data
    ? data.usageMetadata
    : undefined;
  const value = (field: string): number | "unavailable" => {
    if (usage === null || typeof usage !== "object") return "unavailable";
    const count = (usage as Record<string, unknown>)[field];
    return typeof count === "number" && Number.isSafeInteger(count) && count >= 0
      ? count
      : "unavailable";
  };
  return {
    input_tokens: value("promptTokenCount"),
    output_tokens: value("candidatesTokenCount"),
    total_tokens: value("totalTokenCount"),
    thoughts_tokens: value("thoughtsTokenCount"),
    cached_content_tokens: value("cachedContentTokenCount"),
    tool_use_prompt_tokens: value("toolUsePromptTokenCount"),
  };
}

export interface GenerateContentArgs {
  apiKey: string;
  model: string; // "models/gemini-2.5-flash" or "gemini-2.5-flash"
  contents: unknown[];
  systemInstruction?: { parts: { text: string }[] };
  generationConfig?: Record<string, unknown>;
  signal?: AbortSignal;
  /** Local logging metadata only; never sent to Gemini. */
  observation?: GeminiCallObservation;
  /** Optional local observer. Failures are isolated; never sent to the API. */
  onFinished?: (record: Record<string, unknown>) => void;
  /** Runtime-only transport seam for offline fixtures; omitted in application calls. */
  transport?: typeof fetch;
  /** Local response observer, including parsed HTTP error envelopes. Never logged. */
  onResponse?: (data: unknown) => void;
}

export async function generateContent(args: GenerateContentArgs): Promise<unknown> {
  const m = args.model.startsWith("models/") ? args.model : `models/${args.model}`;
  const url = `${BASE}/${m}:generateContent`;
  const init: RequestInit = {
    method: "POST",
    headers: headers(args.apiKey),
    cache: "no-store",
    signal: args.signal,
    body: JSON.stringify({
      contents: args.contents,
      systemInstruction: args.systemInstruction,
      generationConfig: args.generationConfig,
    }),
  };
  const context = args.observation?.context;
  const identity = {
    call_id: randomUUID(),
    request_id: context?.requestId ?? randomUUID(),
    call_index: context ? ++context.callCount : 1,
    stage: args.observation?.stage ?? "generate_content",
    model: args.model,
    request_start_time: new Date().toISOString(),
  };
  logGeminiCall({ event: "started", ...identity });
  // Serialize the request and write the start log before starting the latency clock.
  const started = performance.now();
  let ended: number | undefined;
  let endTime: string | undefined;
  let httpStatus: number | "unavailable" = "unavailable";
  let outcome = "network_error";
  let data: unknown;
  try {
    const res = await (args.transport ?? fetch)(url, init);
    httpStatus = res.status;
    outcome = "response_error";
    // Receive all bytes before stopping the clock; exclude text decoding, JSON
    // parsing and all later storyboard/review processing from provider latency.
    const bytes = await res.arrayBuffer();
    ended = performance.now();
    endTime = new Date().toISOString();
    const text = new TextDecoder().decode(bytes);
    if (!res.ok) {
      outcome = "http_error";
      try {
        data = JSON.parse(text);
      } catch {
        // Non-JSON error bodies have no observable usage metadata.
      }
      throw new Error(`generateContent ${res.status}: ${text}`);
    }
    data = JSON.parse(text);
    outcome = "success";
    return data;
  } finally {
    const finished = ended ?? performance.now();
    const record = {
      event: "finished",
      ...identity,
      request_end_time: endTime ?? new Date().toISOString(),
      latency_ms: Math.round((finished - started) * 1000) / 1000,
      latency_scope: "fetch_and_response_body",
      http_status: httpStatus,
      outcome,
      ...usageFields(data),
    };
    logGeminiCall(record);
    try { args.onResponse?.(data); } catch { /* Observation cannot change behavior. */ }
    try { args.onFinished?.(record); } catch { /* Local observers cannot affect provider behavior. */ }
  }
}

export interface StartVeoArgs {
  apiKey: string;
  model: string;
  prompt: string;
  aspectRatio: "16:9" | "9:16";
  durationSeconds: 4 | 5 | 6 | 8;
  resolution?: "720p" | "1080p" | "4k";
  personGeneration?: "allow_all" | "allow_adult" | "dont_allow";
  image?: { bytesBase64Encoded: string; mimeType: string };
  lastFrame?: { bytesBase64Encoded: string; mimeType: string };
}

export async function startVeoOperation(args: StartVeoArgs): Promise<{ name: string }> {
  const m = args.model.startsWith("models/") ? args.model : `models/${args.model}`;
  const url = `${BASE}/${m}:predictLongRunning`;
  const instances: Record<string, unknown> = { prompt: args.prompt };
  if (args.image) instances.image = args.image;
  if (args.lastFrame) instances.lastFrame = args.lastFrame;
  const parameters: Record<string, unknown> = {
    aspectRatio: args.aspectRatio,
    durationSeconds: Number(args.durationSeconds),
  };
  if (args.resolution) parameters.resolution = args.resolution;
  if (args.personGeneration) parameters.personGeneration = args.personGeneration;
  const res = await fetch(url, {
    method: "POST",
    headers: headers(args.apiKey),
    cache: "no-store",
    body: JSON.stringify({ instances: [instances], parameters }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`startVeo ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { name: string };
  return data;
}

export interface VeoOperationStatus {
  name: string;
  done?: boolean;
  error?: { code: number; message: string };
  response?: {
    generatedVideos?: { video: { uri: string } }[];
    generateVideoResponse?: { generatedSamples?: { video: { uri: string } }[] };
  };
}

export async function getOperation(apiKey: string, operationName: string): Promise<VeoOperationStatus> {
  const url = `${BASE}/${operationName}`;
  const res = await fetch(url, { headers: headers(apiKey), cache: "no-store" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`getOperation ${res.status}: ${text}`);
  }
  return res.json() as Promise<VeoOperationStatus>;
}

export async function downloadVideoStream(apiKey: string, uri: string): Promise<Response> {
  const u = new URL(uri);
  // Some Veo URIs already include alt=media; ensure key header is sent.
  return fetch(u, { headers: { "x-goog-api-key": apiKey } });
}

export interface PredictImageArgs {
  apiKey: string;
  model: string; // e.g. "imagen-4.0-generate-001"
  prompt: string;
  aspectRatio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
  sampleCount?: number;
}

export interface PredictImageResult {
  bytesBase64Encoded: string;
  mimeType: string;
}

export async function predictImage(args: PredictImageArgs): Promise<PredictImageResult> {
  const m = args.model.startsWith("models/") ? args.model : `models/${args.model}`;
  const url = `${BASE}/${m}:predict`;
  const parameters: Record<string, unknown> = { sampleCount: args.sampleCount ?? 1 };
  if (args.aspectRatio) parameters.aspectRatio = args.aspectRatio;
  const res = await fetch(url, {
    method: "POST",
    headers: headers(args.apiKey),
    cache: "no-store",
    body: JSON.stringify({ instances: [{ prompt: args.prompt }], parameters }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`predictImage ${res.status}: ${text}`);
  }
  const data = (await res.json()) as {
    predictions?: { bytesBase64Encoded?: string; mimeType?: string }[];
  };
  const p = data.predictions?.[0];
  if (!p?.bytesBase64Encoded) throw new Error("predictImage: empty prediction");
  return {
    bytesBase64Encoded: p.bytesBase64Encoded,
    mimeType: p.mimeType ?? "image/png",
  };
}
