import { NextRequest, NextResponse } from "next/server";

const apiBase =
  process.env.NEXT_PUBLIC_API_BASE ??
  "https://trackit-dashboard-beryl.vercel.app";

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get("auth-token")?.value;

    if (!token) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    const backendResponse = await fetch(`${apiBase}/api/auth/support/session`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Cookie: `auth-token=${token}`,
      },
    });

    const backendData = await backendResponse.json();

    if (!backendResponse.ok) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    return NextResponse.json(backendData, { status: 200 });
  } catch (error) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
}
