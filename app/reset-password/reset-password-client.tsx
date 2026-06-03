"use client";

import { useEffect, useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";

type FormState = "idle" | "loading" | "success" | "error";

const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "https://backend-production-0eac.up.railway.app";

export default function ResetPasswordClient() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState<FormState>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const initialEmail = useMemo(() => searchParams.get("email") ?? "", [searchParams]);
  const initialToken = useMemo(() => searchParams.get("token") ?? "", [searchParams]);

  useEffect(() => {
    if (initialEmail) {
      setEmail(initialEmail);
    }
    if (initialToken) {
      setToken(initialToken);
    }
  }, [initialEmail, initialToken]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);

    if (!email || !token || !password) {
      setState("error");
      setMessage("Open the reset link from your email to continue.");
      return;
    }
    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSpecial = /[^A-Za-z0-9]/.test(password);
    if (password.length < 8 || !hasUpper || !hasLower || !hasNumber || !hasSpecial) {
      setState("error");
      setMessage("Password must be 8+ chars with upper, lower, number, and special.");
      return;
    }
    if (password != confirm) {
      setState("error");
      setMessage("Passwords do not match.");
      return;
    }

    setState("loading");
    try {
      const response = await fetch(`${apiBase}/api/auth/password/reset/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          token: token.trim(),
          newPassword: password
        })
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(text || "Request failed");
      }

      setState("success");
      setMessage("Password updated. Return to the app and log in.");
      setPassword("");
      setConfirm("");
    } catch {
      setState("error");
      setMessage("Reset failed. Check the token and try again.");
    }
  }

  return (
    <main className="relative overflow-hidden min-h-screen">
      <div className="grid-overlay" />
      <div className="max-w-3xl mx-auto px-6 py-12 relative z-10 fade-in">
        <header className="space-y-4 slide-up">
          <div className="pill pill-accent inline-flex items-center gap-2 px-4 py-2 text-sm glow-hover">
            <ShieldCheck className="h-4 w-4 text-ink" />
            Account recovery
          </div>
          <h1 className="text-4xl md:text-5xl font-semibold font-display tracking-tight">Reset your password</h1>
          <p className="text-sm text-muted max-w-2xl">
            Paste the reset token from your email and choose a new password for your account.
          </p>
        </header>

        <section className="mt-10 card-surface rounded-3xl p-6 md:p-8 slide-up">
          <form onSubmit={handleSubmit} className="grid gap-4">
            <label className="grid gap-2 text-sm text-muted">
              New password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="input-field h-12 rounded-2xl px-4 text-sm outline-none"
                placeholder="At least 8 characters"
                autoComplete="new-password"
              />
            </label>

            <label className="grid gap-2 text-sm text-muted">
              Confirm password
              <input
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                className="input-field h-12 rounded-2xl px-4 text-sm outline-none"
                placeholder="Repeat password"
                autoComplete="new-password"
              />
            </label>

            <button
              type="submit"
              disabled={state == "loading"}
              className="button-primary mt-2 h-12 rounded-2xl font-semibold px-4 text-sm disabled:opacity-60 glow-hover"
            >
              {state == "loading" ? "Updating..." : "Update password"}
            </button>
          </form>

          {message ? (
            <div
              className={`mt-6 rounded-2xl border px-4 py-3 text-sm ${
                state == "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-rose-200 bg-rose-50 text-rose-700"
              }`}
            >
              {message}
            </div>
          ) : null}

          <div className="mt-6 flex flex-wrap gap-2 text-xs text-subtle">
            <span className="pill px-3 py-1">Back in the app, log in with the new password.</span>
          </div>
        </section>
      </div>
    </main>
  );
}
