"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type FormState = "idle" | "loading" | "success" | "error";

const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "https://trackit-dashboard-beryl.vercel.app";

export default function ResetPasswordPage() {
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
    if (initialEmail) setEmail(initialEmail);
    if (initialToken) setToken(initialToken);
  }, [initialEmail, initialToken]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);

    if (!email || !token || !password) {
      setState("error");
      setMessage("Fill in email, token, and new password.");
      return;
    }
    if (password.length < 8) {
      setState("error");
      setMessage("Password must be at least 8 characters.");
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
    <div className="relative min-h-screen px-6 py-16 flex items-center justify-center">
      <div className="grid-overlay" />
      <div className="relative z-10 w-full max-w-lg rounded-[28px] card-surface p-8 md:p-10 fade-in slide-up">
        <div className="flex items-center gap-3 text-xs uppercase tracking-[0.3em] text-sky-200/70">
          <span className="pill px-3 py-1">TrackIt</span>
          <span className="pill px-3 py-1">Reset</span>
        </div>
        <h1 className="mt-5 text-3xl md:text-4xl font-semibold text-white">Reset your password</h1>
        <p className="mt-3 text-sm text-slate-300">
          Paste the reset token from your email and choose a new password for your account.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 grid gap-4">
          <label className="grid gap-2 text-sm text-slate-200">
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-12 rounded-2xl border border-white/10 bg-slate-950/40 px-4 text-white placeholder:text-slate-500 focus:border-sky-400/60 focus:outline-none"
              placeholder="you@trackitco.com"
              autoComplete="email"
            />
          </label>

          <label className="grid gap-2 text-sm text-slate-200">
            Reset token
            <input
              type="text"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              className="h-12 rounded-2xl border border-white/10 bg-slate-950/40 px-4 text-white placeholder:text-slate-500 focus:border-sky-400/60 focus:outline-none"
              placeholder="Paste token"
            />
          </label>

          <label className="grid gap-2 text-sm text-slate-200">
            New password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-12 rounded-2xl border border-white/10 bg-slate-950/40 px-4 text-white placeholder:text-slate-500 focus:border-sky-400/60 focus:outline-none"
              placeholder="At least 8 characters"
              autoComplete="new-password"
            />
          </label>

          <label className="grid gap-2 text-sm text-slate-200">
            Confirm password
            <input
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              className="h-12 rounded-2xl border border-white/10 bg-slate-950/40 px-4 text-white placeholder:text-slate-500 focus:border-sky-400/60 focus:outline-none"
              placeholder="Repeat password"
              autoComplete="new-password"
            />
          </label>

          <button
            type="submit"
            disabled={state == "loading"}
            className="mt-2 h-12 rounded-2xl bg-gradient-to-r from-sky-400 via-cyan-400 to-teal-300 text-slate-950 font-semibold tracking-wide shadow-[0_12px_30px_rgba(56,189,248,0.3)]"
          >
            {state == "loading" ? "Updating..." : "Update password"}
          </button>
        </form>

        {message ? (
          <div
            className={`mt-6 rounded-2xl border px-4 py-3 text-sm ${
              state == "success"
                ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-100"
                : "border-rose-400/40 bg-rose-500/10 text-rose-100"
            }`}
          >
            {message}
          </div>
        ) : null}

        <p className="mt-6 text-xs text-slate-400">
          After resetting, return to the app and log in with your new password.
        </p>
      </div>
    </div>
  );
}
