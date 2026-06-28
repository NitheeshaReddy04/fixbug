import { Link, useNavigate, useRouter, useLocation } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

export function Navbar() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();
  const location = useLocation();
  const showBack = location.pathname !== "/";

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  }

  function goBack() {
    navigate({ to: "/" });
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <div className="flex items-center gap-2">
          {showBack && (
            <button
              onClick={goBack}
              aria-label="Go back"
              className="flex size-8 items-center justify-center rounded-lg border border-border bg-secondary text-secondary-foreground transition hover:bg-accent"
            >
              <ArrowLeft size={16} />
            </button>
          )}
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="text-lg">🐛</span>
            <span>Fixbug</span>
          </Link>
        </div>

        <nav className="flex items-center gap-3 text-sm">
          {user ? (
            <>
              <span className="hidden text-muted-foreground sm:inline">{user.email}</span>
              <button
                onClick={signOut}
                className="rounded-lg border border-border bg-secondary px-3 py-1.5 text-secondary-foreground transition hover:bg-accent"
              >
                Sign out
              </button>
            </>
          ) : (
            <Link
              to="/auth"
              className="text-muted-foreground transition hover:text-foreground"
            >
              Sign in to save history
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
