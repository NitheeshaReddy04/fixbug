import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { Navbar } from "@/components/navbar";
import { useAuth } from "@/hooks/use-auth";
import {
  analyzeErrorGuest,
  analyzeErrorAuthed,
  listAnalyses,
  deleteAnalysis,
  type AnalysisResult,
} from "@/lib/analyze.functions";
import {
  askFollowupGuest,
  askFollowupAuthed,
  listFollowups,
} from "@/lib/followup.functions";

const searchSchema = z.object({ guest: z.boolean().optional() });

export const Route = createFileRoute("/analyzer")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Analyzer — Fixbug" },
      { name: "description", content: "Paste an error and get the cause, fix, and a code example." },
    ],
  }),
  component: AnalyzerPage,
});

const LANGUAGES = [
  "Auto-detect",
  "JavaScript",
  "Python",
  "Java",
  "AWS",
  "Docker",
  "Kubernetes",
  "Terraform",
  "SQL",
  "Other",
];

type Severity = "high" | "medium" | "low";

type HistoryItem = {
  id: string;
  error_text: string;
  language: string;
  detected_language: string | null;
  severity: Severity;
  cause: string;
  steps: unknown;
  fix_example: string | null;
  pro_tip: string | null;
  created_at: string;
};

type ChatMsg = { role: "user" | "assistant"; content: string };

function AnalyzerPage() {
  const { user, loading: authLoading } = useAuth();
  const analyzeGuest = useServerFn(analyzeErrorGuest);
  const analyzeAuthed = useServerFn(analyzeErrorAuthed);
  const fetchHistory = useServerFn(listAnalyses);
  const removeAnalysis = useServerFn(deleteAnalysis);
  const followupGuest = useServerFn(askFollowupGuest);
  const followupAuthed = useServerFn(askFollowupAuthed);
  const fetchFollowups = useServerFn(listFollowups);

  const [errorText, setErrorText] = useState("");
  const [language, setLanguage] = useState("Auto-detect");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [originalError, setOriginalError] = useState<string>("");
  const [uiError, setUiError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // Follow-up state
  const [thread, setThread] = useState<ChatMsg[]>([]);
  const [threadOpen, setThreadOpen] = useState(false);
  const [followupInput, setFollowupInput] = useState("");
  const [followupBusy, setFollowupBusy] = useState(false);
  const [followupError, setFollowupError] = useState<string | null>(null);

  const isGuest = !user;
  const canAnalyze = errorText.trim().length > 0 && !busy;

  useEffect(() => {
    if (!user) {
      setHistory([]);
      return;
    }
    fetchHistory({})
      .then((rows: unknown) => setHistory(rows as HistoryItem[]))
      .catch(() => {});
  }, [user, fetchHistory]);

  function resetThread() {
    setThread([]);
    setThreadOpen(false);
    setFollowupInput("");
    setFollowupError(null);
  }

  async function onAnalyze() {
    if (!canAnalyze) return;
    setBusy(true);
    setUiError(null);
    setResult(null);
    setAnalysisId(null);
    resetThread();
    const trimmed = errorText.trim();
    try {
      const payload = {
        data: {
          errorText: trimmed,
          language: language === "Auto-detect" ? "auto" : language,
        },
      };
      if (user) {
        const res = await analyzeAuthed(payload);
        setResult(res.result);
        setAnalysisId(res.analysisId);
        setOriginalError(trimmed);
        fetchHistory({}).then((rows: unknown) => setHistory(rows as HistoryItem[])).catch(() => {});
      } else {
        const res = await analyzeGuest(payload);
        setResult(res);
        setOriginalError(trimmed);
      }
    } catch (e) {
      console.error(e);
      setUiError("Couldn't analyze that — please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    setHistory((h) => h.filter((x) => x.id !== id));
    if (analysisId === id) {
      setResult(null);
      setAnalysisId(null);
      resetThread();
    }
    try {
      await removeAnalysis({ data: { id } });
    } catch {
      fetchHistory({}).then((rows: unknown) => setHistory(rows as HistoryItem[])).catch(() => {});
    }
  }

  async function onOpenHistory(h: HistoryItem) {
    const steps = Array.isArray(h.steps) ? (h.steps as string[]) : [];
    const reconstructed: AnalysisResult = {
      cause: h.cause,
      severity: h.severity,
      steps,
      fixExample: h.fix_example,
      proTip: h.pro_tip ?? "",
      detectedLanguage: h.detected_language ?? "Unknown",
    };
    setResult(reconstructed);
    setAnalysisId(h.id);
    setOriginalError(h.error_text);
    setErrorText(h.error_text);
    setUiError(null);
    setThread([]);
    setFollowupError(null);
    setFollowupInput("");
    setThreadOpen(true);
    try {
      const rows = (await fetchFollowups({ data: { analysisId: h.id } })) as Array<{
        role: "user" | "assistant";
        content: string;
      }>;
      setThread(rows.map((r) => ({ role: r.role, content: r.content })));
    } catch {
      // ignore — empty thread
    }
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  async function onAskFollowup() {
    const q = followupInput.trim();
    if (!q || followupBusy || !result) return;
    setFollowupBusy(true);
    setFollowupError(null);
    const history = [...thread];
    setThread((t) => [...t, { role: "user", content: q }]);
    setFollowupInput("");
    try {
      const payload = {
        data: {
          originalError,
          originalDiagnosis: {
            cause: result.cause,
            severity: result.severity,
            steps: result.steps,
            fixExample: result.fixExample,
            proTip: result.proTip,
            detectedLanguage: result.detectedLanguage,
          },
          conversationHistory: history,
          newQuestion: q,
          ...(user && analysisId ? { analysisId } : {}),
        },
      };
      const res = user
        ? await followupAuthed(payload)
        : await followupGuest(payload);
      setThread((t) => [...t, { role: "assistant", content: res.answer }]);
    } catch (e) {
      console.error(e);
      setFollowupError("Couldn't get an answer — try again.");
      // roll back the user message so they can retry without duplication? keep it so they see what they asked.
    } finally {
      setFollowupBusy(false);
    }
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="mx-auto max-w-5xl px-4 pb-24 pt-10">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            🔍 Analyze an error
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Paste the error text — full stack trace is even better.
          </p>
        </header>

        <section className="panel p-5">
          <label className="mb-2 block text-xs font-medium text-muted-foreground">
            Paste your error message here
          </label>
          <textarea
            value={errorText}
            onChange={(e) => setErrorText(e.target.value)}
            placeholder="e.g. TypeError: Cannot read properties of undefined (reading 'map') at HomePage..."
            rows={10}
            className="w-full resize-y rounded-lg border border-border bg-background/60 p-3 font-mono text-sm leading-relaxed outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30"
          />

          <div className="mt-4">
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              Language / platform
            </div>
            <div className="flex flex-wrap gap-2">
              {LANGUAGES.map((lang) => {
                const active = lang === language;
                return (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => setLanguage(lang)}
                    className={
                      "rounded-full border px-3 py-1 text-xs transition " +
                      (active
                        ? "border-primary bg-primary/15 text-foreground"
                        : "border-border bg-secondary text-muted-foreground hover:text-foreground")
                    }
                  >
                    {lang}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {authLoading
                ? " "
                : isGuest
                  ? "Guest mode — nothing is saved."
                  : `Signed in as ${user!.email}. Result saves automatically.`}
            </p>
            <button
              onClick={onAnalyze}
              disabled={!canAnalyze}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:accent-glow disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "🔍 Analyzing…" : "Analyze"}
            </button>
          </div>
        </section>

        {uiError && (
          <div className="mt-5 panel border-destructive/40 p-4 text-sm">
            <div className="font-medium">Couldn't analyze that</div>
            <p className="mt-1 text-muted-foreground">{uiError}</p>
            <button
              onClick={onAnalyze}
              className="mt-3 rounded-lg border border-border bg-secondary px-3 py-1.5 text-xs transition hover:bg-accent"
            >
              Try again
            </button>
          </div>
        )}

        {result && (
          <>
            <ResultCard result={result} />
            <FollowupThread
              open={threadOpen}
              onToggle={() => setThreadOpen((v) => !v)}
              thread={thread}
              input={followupInput}
              setInput={setFollowupInput}
              onSend={onAskFollowup}
              busy={followupBusy}
              error={followupError}
              isGuest={isGuest}
            />
          </>
        )}

        {user && (
          <section className="mt-10">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Recent analyses
              </h2>
              <span className="text-xs text-muted-foreground">{history.length} saved</span>
            </div>
            {history.length === 0 ? (
              <div className="panel p-5 text-sm text-muted-foreground">
                Nothing yet — your analyses will appear here.
              </div>
            ) : (
              <ul className="space-y-2">
                {history.map((h) => (
                  <li key={h.id} className="panel p-4">
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => onOpenHistory(h)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <SeverityDot severity={h.severity} />
                          <span>{h.detected_language ?? "Unknown"}</span>
                          <span>·</span>
                          <span>{new Date(h.created_at).toLocaleString()}</span>
                        </div>
                        <p className="mt-1.5 truncate font-mono text-xs text-muted-foreground">
                          {h.error_text.split("\n")[0]}
                        </p>
                        <p className="mt-1 line-clamp-2 text-sm">{h.cause}</p>
                      </button>
                      <button
                        onClick={() => onDelete(h.id)}
                        className="rounded-md border border-border bg-secondary px-2 py-1 text-xs text-muted-foreground transition hover:text-foreground"
                        aria-label="Delete"
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

function FollowupThread({
  open,
  onToggle,
  thread,
  input,
  setInput,
  onSend,
  busy,
  error,
  isGuest,
}: {
  open: boolean;
  onToggle: () => void;
  thread: ChatMsg[];
  input: string;
  setInput: (v: string) => void;
  onSend: () => void;
  busy: boolean;
  error: string | null;
  isGuest: boolean;
}) {
  return (
    <section className="mt-4">
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex items-center gap-2 rounded-xl border border-border bg-secondary px-4 py-2 text-sm transition hover:text-foreground"
      >
        💬 {open ? "Hide follow-up" : "Ask a follow-up"}
      </button>

      {open && (
        <div className="mt-3 panel p-5">
          {isGuest && thread.length === 0 && (
            <p className="mb-3 text-xs text-muted-foreground">
              Guest mode — this thread won't persist after refresh.
            </p>
          )}

          {thread.length > 0 && (
            <div className="mb-4 space-y-3">
              {thread.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl bg-primary/15 px-4 py-2 text-sm font-medium text-foreground">
                      {m.content}
                    </div>
                  </div>
                ) : (
                  <div key={i} className="flex justify-start">
                    <div className="max-w-[90%] rounded-2xl border border-border bg-background/60 px-4 py-3 text-sm leading-relaxed">
                      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        Fixbug
                      </div>
                      <div className="whitespace-pre-wrap">{m.content}</div>
                    </div>
                  </div>
                ),
              )}
              {busy && (
                <div className="flex justify-start">
                  <div className="rounded-2xl border border-border bg-background/60 px-4 py-2 text-sm text-muted-foreground">
                    🔍 Thinking…
                  </div>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="mb-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
              {error}
            </div>
          )}

          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSend();
                }
              }}
              rows={2}
              placeholder="Ask a follow-up question about this error…"
              className="flex-1 resize-y rounded-lg border border-border bg-background/60 p-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30"
            />
            <button
              onClick={onSend}
              disabled={busy || input.trim().length === 0}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:accent-glow disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "…" : "Send"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function ResultCard({ result }: { result: AnalysisResult }) {
  return (
    <section className="mt-6 panel p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Detected: <span className="text-foreground">{result.detectedLanguage}</span>
        </div>
        <SeverityBadge severity={result.severity} />
      </div>

      <Section title="🐛 What happened">
        <p className="leading-relaxed">{result.cause}</p>
      </Section>

      <Section title="⚡ How to fix it">
        <ol className="ml-4 list-decimal space-y-1.5 leading-relaxed">
          {result.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </Section>

      {result.fixExample && (
        <Section title="📝 Example fix">
          <pre className="overflow-x-auto rounded-lg border border-border bg-background/60 p-3 font-mono text-xs leading-relaxed">
{result.fixExample}
          </pre>
        </Section>
      )}

      <Section title="✅ Pro tip">
        <p className="leading-relaxed text-muted-foreground">{result.proTip}</p>
      </Section>
    </section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5 first:mt-0">
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: Severity }) {
  const map = useMemo(
    () => ({
      high: { label: "High", color: "var(--color-severity-high)" },
      medium: { label: "Medium", color: "var(--color-severity-medium)" },
      low: { label: "Low", color: "var(--color-severity-low)" },
    }),
    [],
  );
  const cfg = map[severity];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs"
      style={{ color: cfg.color }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: cfg.color }} />
      {cfg.label} severity
    </span>
  );
}

function SeverityDot({ severity }: { severity: Severity }) {
  const c =
    severity === "high"
      ? "var(--color-severity-high)"
      : severity === "medium"
        ? "var(--color-severity-medium)"
        : "var(--color-severity-low)";
  return <span className="size-1.5 rounded-full" style={{ backgroundColor: c }} />;
}
