import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Navbar } from "@/components/navbar";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Fixbug — Paste any error. Know exactly why it happened." },
      {
        name: "description",
        content:
          "Fixbug is an AI error explainer for developers. Paste any error from any language or platform and get the root cause, fix steps, and a code example.",
      },
      { property: "og:title", content: "Fixbug — AI error explainer for developers" },
      {
        property: "og:description",
        content: "Paste any error. Know exactly why it happened, and how to fix it.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  useEffect(() => {
    let stay = false;
    try {
      stay = sessionStorage.getItem("fixbug:stay-home") === "1";
      if (stay) sessionStorage.removeItem("fixbug:stay-home");
    } catch {}
    if (stay) return;
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/analyzer" });
    });
  }, [navigate]);
  return (
    <div className="min-h-screen">
      <Navbar />

      <main className="mx-auto max-w-6xl px-4 pb-24 pt-16 sm:pt-24">
        <section className="grid items-center gap-12 md:grid-cols-[1.1fr_1fr]">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
              <span>⚡</span> AI-powered, language-agnostic
            </div>
            <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl md:text-6xl">
              Paste any error.{" "}
              <span className="text-primary">Know exactly why</span> it happened.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Fixbug reads errors from JavaScript, Python, AWS, Docker, Kubernetes,
              Terraform, SQL — anything — and tells you the cause, the fix, and how
              to never see it again.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/auth"
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:accent-glow"
              >
                Sign in
              </Link>
              <Link
                to="/analyzer"
                search={{ guest: true }}
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-secondary px-5 py-2.5 text-sm font-medium text-secondary-foreground transition hover:bg-accent"
              >
                Continue as guest →
              </Link>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Guest mode skips auth. Sign in to save your history.
            </p>
          </div>

          <MockResultPreview />
        </section>

        <section className="mt-24 grid gap-4 sm:grid-cols-3">
          <Feature emoji="🔍" title="Auto-detect language">
            Don't know what stack it's from? Fixbug figures it out from the text.
          </Feature>
          <Feature emoji="⚡" title="Fix in seconds">
            Get root cause, step-by-step fix, and a corrected snippet.
          </Feature>
          <Feature emoji="✅" title="Stop repeating mistakes">
            Every result ends with a pro tip so you don't hit the same wall twice.
          </Feature>
        </section>
      </main>
      <footer className="border-t border-border/60 py-6 text-center text-xs text-muted-foreground">
        Designed and developed by Nitheesha
      </footer>
    </div>
  );
}

function Feature({
  emoji,
  title,
  children,
}: {
  emoji: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="panel p-5">
      <div className="mb-2 text-lg">{emoji}</div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

function MockResultPreview() {
  return (
    <div className="panel relative overflow-hidden p-5">
      <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-mono">TypeError</span>
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5">
          <span className="size-1.5 rounded-full bg-[color:var(--color-severity-medium)]" />
          Medium
        </span>
      </div>
      <pre className="rounded-lg border border-border bg-background/60 p-3 font-mono text-xs leading-relaxed text-muted-foreground">
{`Cannot read properties of
undefined (reading 'map')`}
      </pre>

      <div className="mt-4 space-y-3 text-sm">
        <div>
          <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
            🐛 What happened
          </div>
          <p className="leading-relaxed">
            You're calling <code className="rounded bg-background px-1 py-0.5 font-mono text-xs">.map()</code> on a value
            that's <code className="rounded bg-background px-1 py-0.5 font-mono text-xs">undefined</code> — usually because
            data hasn't loaded yet.
          </p>
        </div>
        <div>
          <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
            ⚡ How to fix
          </div>
          <ol className="ml-4 list-decimal space-y-1 text-muted-foreground">
            <li>Default the array: <span className="font-mono text-foreground">items ?? []</span></li>
            <li>Render a loading state until data arrives</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
