import type { Storyboard } from "@/lib/types";
import { languageName } from "@/lib/prompts/storyboard";

/**
 * Deterministic post-processing: guarantee that
 *  - subtitle == verbatim join of dialogue lines (when subtitles enabled)
 *  - veoPrompt ends with `The {speaker} says in {LanguageName}: "<verbatim line>"`
 *    appended for every dialogue line that isn't already present verbatim.
 * This compensates for LLM drift (paraphrasing, English-only quoting, missing dialogue).
 */
export function normalizeDialogueAndSubtitle(
  sb: Storyboard,
  langTag: string | undefined,
  withSubtitle: boolean
): Storyboard {
  const langName = languageName(langTag);
  const shots = sb.shots.map((shot) => {
    const dialogues = (shot.dialogue ?? []).filter((d) => d?.line?.trim());
    let veoPrompt = shot.veoPrompt ?? "";
    const missing: string[] = [];
    for (const d of dialogues) {
      const line = d.line.trim();
      if (!veoPrompt.includes(line)) {
        const speaker = (d.speaker ?? "narrator").trim() || "narrator";
        missing.push(`The ${speaker} says in ${langName}: "${line}"`);
      }
    }
    if (missing.length > 0) {
      veoPrompt = veoPrompt.replace(/\s+$/, "");
      const sep = veoPrompt && !/[.!?]$/.test(veoPrompt) ? ". " : " ";
      veoPrompt = `${veoPrompt}${veoPrompt ? sep : ""}${missing.join(" Then ")}.`;
    }
    const subtitle = withSubtitle
      ? dialogues.map((d) => d.line.trim()).join(" ")
      : "";
    return { ...shot, veoPrompt, subtitle };
  });
  return { ...sb, shots };
}
