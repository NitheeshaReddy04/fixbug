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

type HistoryItem = {
  id: string;
  error_text: string;
  detected_language: string | null;
  severity: "high" | "medium" | "low";
  cause: string;
  created_at: string;
};

function AnalyzerPage() {
  const { user, loading: authLoading } = useAuth();
  const analyzeGuest = useServerFn(analyzeErrorGuest);
  const analyzeAuthed = useServerFn(analyzeErrorAuthed);
  const fetchHistory = useServerFn(listAnalyses);
  const removeAnalysis = useServerFn(deleteAnalysis);

  const [errorText, setErrorText] = useState("");
  const [language, setLanguage] = useState("Auto-detect");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [uiError, setUiError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

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

  async function onAnalyze() {
    if (!canAnalyze) return;
    setBusy(true);
    setUiError(null);
    setResult(null);
    try {
      const payload = {
        data: {
          errorText: errorText.trim(),
          language: language === "Auto-detect" ? "auto" : language,
        },
      };
      const res = user ? await analyzeAuthed(payload) : await analyzeGuest(payload);
      setResult(res);
      if (user) {
        fetchHistory({}).then((rows: unknown) => setHistory(rows as HistoryItem[])).catch(() => {});
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
    try {
      await removeAnalysis({ data: { id } });
    } catch {
      fetchHistory({}).then((rows: unknown) => setHistory(rows as HistoryItem[])).catch(() => {});
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

        {result && <ResultCard result={result} />}

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
                      <div className="min-w-0 flex-1">
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
                      </div>
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

function SeverityBadge({ severity }: { severity: "high" | "medium" | "low" }) {
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

function SeverityDot({ severity }: { severity: "high" | "medium" | "low" }) {
  const c =
    severity === "high"
      ? "var(--color-severity-high)"
      : severity === "medium"
        ? "var(--color-severity-medium)"
        : "var(--color-severity-low)";
  return <span className="size-1.5 rounded-full" style={{ backgroundColor: c }} />;
}
