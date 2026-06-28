import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const AnalyzeInput = z.object({
  errorText: z.string().min(1).max(20000),
  language: z.string().min(1).max(50).default("auto"),
});

const ResultSchema = z.object({
  cause: z.string(),
  severity: z.enum(["high", "medium", "low"]),
  steps: z.array(z.string()).min(1).max(8),
  fixExample: z.string().nullable(),
  proTip: z.string(),
  detectedLanguage: z.string(),
});

export type AnalysisResult = z.infer<typeof ResultSchema>;

const SYSTEM_PROMPT = `You are a senior infrastructure/software debugging expert. You will be given an error message and must return ONLY valid JSON matching this schema:

{
  "cause": "string",
  "severity": "high" | "medium" | "low",
  "steps": ["string"],
  "fixExample": "string or null",
  "proTip": "string",
  "detectedLanguage": "string"
}

Before writing your final answer, internally work through these steps (do not output this reasoning, only the final JSON):

1. IDENTIFY THE SYMPTOM vs THE ROOT CAUSE. Many errors show a surface-level failure (e.g. a failed health check, a connection refused, a timeout) that is actually caused by something deeper (e.g. an OOM kill, an expired credential, a missing permission). Always trace to the deepest verifiable cause, not the most visible log line. If the error contains exit codes, reason codes, or status codes (e.g. OOMKilled, exit code 137, ImagePullBackOff, CrashLoopBackOff), prioritize those over generic warnings nearby.

2. WRITE the cause, steps, fixExample, and proTip as a draft.

3. SELF-CHECK before finalizing — verify all of the following, and fix any that fail BEFORE returning your answer:
   a. Does fixExample actually implement what proTip recommends? (e.g. if proTip says "set X equal to Y," the code in fixExample must set X equal to Y — not just close to it.)
   b. Do the numbered steps logically lead to fixExample? Each step should be something the user can actually act on, not vague advice.
   c. If diagnosis involves inspecting state that gets overwritten after a restart/retry (e.g. a crashed and restarted container, a replaced pod, a re-run job), include the correct command to see the PRIOR state, not just the current one (e.g. \\\`kubectl logs --previous\\\`, not just \\\`kubectl logs\\\`).
   d. Is severity justified by the actual failure mode, not just guessed?

4. Only after the self-check passes, output the final JSON. Never output reasoning, markdown, or text outside the JSON object.

If you are not fully certain of the root cause from the given information, say so honestly in "cause" (e.g. "Most likely X, but Y is also possible — check logs to confirm") rather than guessing confidently.

Additional constraints:
- detectedLanguage: detect from the error text if the user passed "auto"; otherwise honor their hint.
- steps: 3-6 short actionable items.
- fixExample: a concrete corrected code/config snippet, or null if not applicable — never invent code.
- severity: "high" = breaks production / data loss / security; "medium" = blocks a feature; "low" = warning or cosmetic.
- cause and proTip: 1-3 sentences each, concrete, no fluff.\`;

async function callAi(errorText: string, language: string): Promise<AnalysisResult> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("AI service is not configured");

  const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
  const { generateText } = await import("ai");

  const gateway = createLovableAiGatewayProvider(apiKey);
  const userPrompt = `Language/platform hint: ${language}\n\nError message:\n"""\n${errorText}\n"""\n\nReturn ONLY the JSON object.`;

  const { text } = await generateText({
    model: gateway("google/gemini-3-flash-preview"),
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
  });

  // Strip code fences if model added them despite instructions
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Try to extract first JSON object
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI returned an unparseable response");
    parsed = JSON.parse(match[0]);
  }

  return ResultSchema.parse(parsed);
}

/** Guest analyzer — no auth, nothing persisted. */
export const analyzeErrorGuest = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => AnalyzeInput.parse(d))
  .handler(async ({ data }) => {
    return await callAi(data.errorText, data.language);
  });

/** Signed-in analyzer — saves to history. */
export const analyzeErrorAuthed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AnalyzeInput.parse(d))
  .handler(async ({ data, context }) => {
    const result = await callAi(data.errorText, data.language);

    const { error } = await context.supabase.from("analyses").insert({
      user_id: context.userId,
      error_text: data.errorText,
      language: data.language,
      detected_language: result.detectedLanguage,
      cause: result.cause,
      severity: result.severity,
      steps: result.steps,
      fix_example: result.fixExample,
      pro_tip: result.proTip,
    });
    if (error) console.error("Failed to save analysis:", error);

    return result;
  });

export const listAnalyses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("analyses")
      .select("id, error_text, detected_language, severity, cause, created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const deleteAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("analyses").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
