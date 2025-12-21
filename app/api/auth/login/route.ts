import { NextRequest, NextResponse } from "next/server";

const apiBase =
  process.env.NEXT_PUBLIC_API_BASE ??
  "https://trackit-dashboard-beryl.vercel.app";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    const backendResponse = await fetch(`${apiBase}/api/auth/support/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const backendData = await backendResponse.json();

    if (!backendResponse.ok) {
      return NextResponse.json(
        { error: backendData.error || "Login failed" },
        { status: backendResponse.status }
      );
    }

    const response = NextResponse.json({ success: true });
    if (backendData.token) {
      response.cookies.set("auth-token", backendData.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60,
      });
    }

    return response;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
