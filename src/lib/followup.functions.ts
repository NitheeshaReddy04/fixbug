import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const DiagnosisSchema = z.object({
  cause: z.string(),
  severity: z.string(),
  steps: z.array(z.string()),
  fixExample: z.string().nullable(),
  proTip: z.string(),
  detectedLanguage: z.string().optional(),
});

const HistoryMsg = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const FollowupInput = z.object({
  originalError: z.string().min(1).max(20000),
  originalDiagnosis: DiagnosisSchema,
  conversationHistory: z.array(HistoryMsg).max(40).default([]),
  newQuestion: z.string().min(1).max(4000),
  analysisId: z.string().uuid().optional(),
});

const SYSTEM_PROMPT = `You are continuing a debugging conversation about a specific error that was already diagnosed. You will be given the original error, the original diagnosis (cause, steps, fix example, pro tip), the prior follow-up conversation if any, and a new question.

Answer the new question directly and specifically, using the original error and diagnosis as ground truth context — do not contradict the original diagnosis unless the user's question reveals new information that changes it (e.g. they paste additional logs or describe something that rules out the original cause). If that happens, explicitly say the diagnosis is being revised and explain why.

Keep answers focused and practical — code snippets where relevant, no unnecessary repetition of the original diagnosis unless asked. Respond in plain text/markdown (not JSON) since this is a conversational follow-up.`;

async function callFollowupAi(input: z.infer<typeof FollowupInput>): Promise<string> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("AI service is not configured");

  const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
  const { generateText } = await import("ai");

  const gateway = createLovableAiGatewayProvider(apiKey);

  const contextBlock = `ORIGINAL ERROR:
"""
${input.originalError}
"""

ORIGINAL DIAGNOSIS (ground truth):
- Cause: ${input.originalDiagnosis.cause}
- Severity: ${input.originalDiagnosis.severity}
- Steps:
${input.originalDiagnosis.steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}
- Fix example: ${input.originalDiagnosis.fixExample ?? "(none)"}
- Pro tip: ${input.originalDiagnosis.proTip}`;

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: contextBlock },
    { role: "assistant", content: "Understood. I'll use that diagnosis as ground truth and answer your follow-up questions." },
    ...input.conversationHistory,
    { role: "user", content: input.newQuestion },
  ];

  const { text } = await generateText({
    model: gateway("google/gemini-3-flash-preview"),
    messages,
  });

  return text.trim();
}

export const askFollowupGuest = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => FollowupInput.parse(d))
  .handler(async ({ data }) => {
    const answer = await callFollowupAi(data);
    return { answer };
  });

export const askFollowupAuthed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => FollowupInput.parse(d))
  .handler(async ({ data, context }) => {
    const answer = await callFollowupAi(data);

    if (data.analysisId) {
      // Verify ownership via RLS by attempting insert with user_id
      const rows = [
        { analysis_id: data.analysisId, user_id: context.userId, role: "user", content: data.newQuestion },
        { analysis_id: data.analysisId, user_id: context.userId, role: "assistant", content: answer },
      ];
      const { error } = await context.supabase.from("analysis_followups").insert(rows);
      if (error) console.error("Failed to save followup:", error);
    }

    return { answer };
  });

export const listFollowups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ analysisId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("analysis_followups")
      .select("id, role, content, created_at")
      .eq("analysis_id", data.analysisId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
