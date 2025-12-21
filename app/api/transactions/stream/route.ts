import { NextRequest } from "next/server";

const apiBase =
  process.env.NEXT_PUBLIC_API_BASE ??
  "https://trackit-dashboard-beryl.vercel.app";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");
  const token = request.cookies.get("auth-token")?.value;

  if (!userId) {
    return new Response("Missing userId", { status: 400 });
  }

  if (!token) {
    return new Response("Unauthorized", { status: 401 });
  }

  const backendUrl = `${apiBase}/api/transactions/stream?userId=${encodeURIComponent(userId)}&token=${encodeURIComponent(token)}`;

  try {
    const backendResponse = await fetch(backendUrl, {
      method: "GET",
      headers: {
        Cookie: `auth-token=${token}`,
        Authorization: `Bearer ${token}`,
      },
    });

    if (!backendResponse.ok) {
      return new Response("Backend request failed", { 
        status: backendResponse.status 
      });
    }

    return new Response(backendResponse.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Stream proxy error:", error);
    return new Response("Internal server error", { status: 500 });
  }
}

