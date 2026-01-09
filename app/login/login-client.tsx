"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";

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
      const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "https://backend-production-0eac.up.railway.app";
      const response = await fetch(`${apiBase}/api/auth/dashboard/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password: password
        })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const errorMessage = data.error || "Invalid email or password";
        throw new Error(errorMessage);
      }

      if (data.token) {
        document.cookie = `auth-token=${data.token}; path=/; max-age=${60 * 60 * 24}; SameSite=Lax; Secure`;
      }

      router.push("/");
      router.refresh();
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "Invalid email or password.");
    }
  }

  return (
    <main className="relative overflow-hidden min-h-screen">
      <div className="grid-overlay" />
      <div className="max-w-md mx-auto px-6 py-12 relative z-10 fade-in">
        <header className="space-y-4 slide-up">
          <div className="pill inline-flex items-center gap-2 px-4 py-2 text-sm text-slate-200 glow-hover">
            <ShieldCheck className="h-4 w-4 text-lime-300" />
            Support access
          </div>
          <h1 className="text-4xl md:text-5xl font-semibold font-display tracking-tight">Sign in</h1>
          <p className="text-sm text-slate-300 max-w-2xl">
            Access the TrackIt support dashboard with your credentials.
          </p>
        </header>

        <section className="mt-10 card-surface rounded-3xl p-6 md:p-8 slide-up">
          <form onSubmit={handleSubmit} className="grid gap-4">
            <label className="grid gap-2 text-sm text-slate-200">
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="h-12 rounded-2xl border border-white/15 bg-white/5 px-4 text-sm outline-none focus:border-cyan-300/60 focus:bg-white/10"
                placeholder="support@trackit.com"
                autoComplete="email"
                required
              />
            </label>

            <label className="grid gap-2 text-sm text-slate-200">
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-12 rounded-2xl border border-white/15 bg-white/5 px-4 text-sm outline-none focus:border-cyan-300/60 focus:bg-white/10"
                placeholder="Enter your password"
                autoComplete="current-password"
                required
              />
            </label>

            <button
              type="submit"
              disabled={state === "loading"}
              className="mt-2 h-12 rounded-2xl bg-gradient-to-r from-cyan-300 to-sky-400 text-slate-900 font-semibold px-4 text-sm shadow-lg shadow-cyan-500/30 disabled:opacity-60 glow-hover"
            >
              {state === "loading" ? "Signing in..." : "Sign in"}
            </button>
          </form>

          {message ? (
            <div
              className={`mt-6 rounded-2xl border px-4 py-3 text-sm ${
                state === "error"
                  ? "border-rose-400/40 bg-rose-500/10 text-rose-100"
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
