export const AUTH_STORAGE_KEY = "trackit_dashboard_token";

export function getApiBase(): string {
  return (
    process.env.NEXT_PUBLIC_API_BASE ?? "https://backend-production-0eac.up.railway.app"
  ).replace(/\/$/, "");
}

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(AUTH_STORAGE_KEY);
  if (stored) return stored;
  const cookie = document.cookie
    .split("; ")
    .find((row) => row.startsWith("auth-token="))
    ?.split("=")[1];
  return cookie ?? null;
}

export function setStoredToken(token: string): void {
  window.localStorage.setItem(AUTH_STORAGE_KEY, token);
  document.cookie = `auth-token=${token}; path=/; max-age=${60 * 60 * 24}; SameSite=Lax; Secure`;
}

export function clearAuth(): void {
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
  document.cookie = "auth-token=; path=/; max-age=0; SameSite=Lax; Secure";
}

export function redirectToLogin(): void {
  clearAuth();
  if (typeof window !== "undefined") {
    window.location.replace("/login");
  }
}

export function buildAuthHeaders(token: string | null, extra?: HeadersInit): HeadersInit {
  return {
    ...(extra ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function apiFetch(
  url: string,
  token: string | null,
  init?: RequestInit,
  onUnauthorized?: () => void
): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: buildAuthHeaders(token, init?.headers),
    credentials: "include",
    cache: init?.cache ?? "no-store",
  });
  if (res.status === 401) {
    if (onUnauthorized) onUnauthorized();
    else redirectToLogin();
  }
  return res;
}
