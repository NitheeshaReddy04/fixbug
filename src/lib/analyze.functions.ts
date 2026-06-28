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

const SYSTEM_PROMPT = `You are Fixbug, an expert developer assistant that explains and fixes error messages from any language, framework, or platform (JavaScript, Python, Java, AWS, Docker, Kubernetes, Terraform, SQL, etc).

You MUST respond with a single valid JSON object and NOTHING else. No markdown, no code fences, no commentary. The JSON must match exactly this schema:

{
  "cause": string,           // 1-3 sentences in plain language, root cause
  "severity": "high" | "medium" | "low",
  "steps": string[],         // 3-6 short actionable items
  "fixExample": string|null, // short corrected code/config snippet, or null if not applicable
  "proTip": string,          // 1-2 sentences on how to avoid this in the future
  "detectedLanguage": string // the language/platform you detected (e.g. "JavaScript", "AWS S3", "Docker")
}

Rules:
- If the user passed a specific language, honor it; if "auto" or unknown, detect it from the error text.
- Set fixExample to null if a snippet isn't relevant — never invent code.
- Severity: "high" = breaks production / data loss / security; "medium" = blocks a feature; "low" = warning or cosmetic.
- Keep tone clear, concrete, no fluff.`;

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
