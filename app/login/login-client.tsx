"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { getApiBase, setStoredToken } from "@/lib/dashboard-api";

type FormState = "idle" | "loading" | "error";

export default function LoginClient() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<FormState>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    setState("loading");

    try {
      const apiBase = getApiBase();
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 10000);
      const response = await fetch(`${apiBase}/api/auth/dashboard/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password: password
        }),
        signal: controller.signal,
      });
      window.clearTimeout(timeoutId);

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const errorMessage = data.error || "Invalid email or password";
        throw new Error(errorMessage);
      }

      if (data.token) {
        setStoredToken(data.token);
      }

      router.push("/");
      router.refresh();
      window.setTimeout(() => {
        if (window.location.pathname === "/login") {
          window.location.assign("/");
        }
      }, 300);
    } catch (err) {
      setState("error");
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      setMessage(isAbort ? "Login request timed out. Please try again." : (err instanceof Error ? err.message : "Invalid email or password."));
    }
  }

  return (
    <main className="relative overflow-hidden min-h-screen">
      <div className="grid-overlay" />
      <div className="max-w-md mx-auto px-6 py-12 relative z-10 fade-in">
        <header className="space-y-4 slide-up">
          <div className="pill pill-accent inline-flex items-center gap-2 px-4 py-2 text-sm glow-hover">
            <ShieldCheck className="h-4 w-4 text-ink" />
            Support access
          </div>
          <h1 className="text-4xl md:text-5xl font-semibold font-display tracking-tight">Sign in</h1>
          <p className="text-sm text-muted max-w-2xl">
            Access the TrackIt support dashboard with your credentials.
          </p>
        </header>

        <section className="mt-10 card-surface rounded-3xl p-6 md:p-8 slide-up">
          <form onSubmit={handleSubmit} className="grid gap-4">
            <label className="grid gap-2 text-sm text-muted">
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="input-field h-12 rounded-2xl px-4 text-sm outline-none"
                placeholder="support@trackit.com"
                autoComplete="email"
                required
              />
            </label>

            <label className="grid gap-2 text-sm text-muted">
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="input-field h-12 rounded-2xl px-4 text-sm outline-none"
                placeholder="Enter your password"
                autoComplete="current-password"
                required
              />
            </label>

            <button
              type="submit"
              disabled={state === "loading"}
              className="button-primary mt-2 h-12 rounded-2xl font-semibold px-4 text-sm disabled:opacity-60 glow-hover"
            >
              {state === "loading" ? "Signing in..." : "Sign in"}
            </button>
          </form>

          {message ? (
            <div
              className={`mt-6 rounded-2xl border px-4 py-3 text-sm ${
                state === "error"
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : ""
              }`}
            >
              {message}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
