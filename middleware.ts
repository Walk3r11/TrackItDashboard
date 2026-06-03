import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

function getJwtSecret(): Uint8Array | null {
  const raw = process.env.JWT_SECRET;
  if (!raw) return null;
  return new TextEncoder().encode(raw);
}

function isNextInternal(pathname: string): boolean {
  return pathname.startsWith("/_next");
}

function isDocumentNavigation(request: NextRequest): boolean {
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("text/html");
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isNextInternal(pathname)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/reset-password")) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/login")) {
    const jwtSecret = getJwtSecret();
    const token = request.cookies.get("auth-token")?.value;
    if (jwtSecret && token) {
      try {
        const { payload } = await jwtVerify(token, jwtSecret);
        if (payload.role === "support") {
          return NextResponse.redirect(new URL("/", request.url));
        }
      } catch {
        /* invalid cookie — stay on login */
      }
    }
    return NextResponse.next();
  }

  const jwtSecret = getJwtSecret();
  const token = request.cookies.get("auth-token")?.value;

  if (!jwtSecret || !token) {
    if (isDocumentNavigation(request)) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { payload } = await jwtVerify(token, jwtSecret);
    if (payload.role !== "support") {
      throw new Error("Invalid role");
    }
    return NextResponse.next();
  } catch {
    if (isDocumentNavigation(request)) {
      const response = NextResponse.redirect(new URL("/login", request.url));
      response.cookies.delete("auth-token");
      return response;
    }
    const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    response.cookies.delete("auth-token");
    return response;
  }
}

export const config = {
  matcher: ["/((?!_next|favicon.ico|.*\\..*).*)"],
};

