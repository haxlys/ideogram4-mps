

/** True when raw JSON is a non-empty Ideogram caption suitable for image generation. */
export function hasSubstantiveCaptionJson(rawJson: string): boolean {
  const trimmed = rawJson.trim();
  if (!trimmed) return false;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;
    const hld = (parsed as Record<string, unknown>).high_level_description;
    return typeof hld === "string" && hld.trim().length > 0;
  } catch {
    return false;
  }
}

export interface MagicPromptStatusLike {
  enabled: boolean;
  configured: boolean;
  missing_env: string[];
  llm_error: string | null;
}

export function magicPromptBlockingReason(
  status: MagicPromptStatusLike | null,
): string | null {
  if (!status) return "Checking Magic Prompt settings…";
  if (!status.enabled) {
    return "Magic Prompt is disabled. Configure IDEOGRAM4_MAGIC_PROMPT_* to enable it.";
  }
  if (!status.configured) {
    if (status.missing_env.length > 0) return `Magic Prompt is not configured: ${status.missing_env.join(", ")}`;
    return `Magic Prompt is not configured: ${status.llm_error ?? "LLM is not reachable"}`;
  }
  return null;
}