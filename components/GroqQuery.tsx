"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Bot, Send, Loader2, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiFetch, getStoredToken } from "@/lib/dashboard-api";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  isError?: boolean;
};

type GroqQueryProps = {
  userId: string;
  apiBase: string;
};

const MAX_COMPLETION_TOKENS = 1024;
const MAX_MESSAGES_FOR_API = 6;

function isErrorAssistantMessage(content: string): boolean {
  return (
    content.startsWith("Authentication error") ||
    content.includes("Request too large") ||
    content.includes("Rate limit reached") ||
    content.includes("Something went wrong")
  );
}

function messagesForGroqApi(messages: Message[]): { role: "user" | "assistant"; content: string }[] {
  return messages
    .filter((msg) => !(msg.role === "assistant" && (msg.isError || isErrorAssistantMessage(msg.content))))
    .slice(-MAX_MESSAGES_FOR_API)
    .map(({ role, content }) => ({ role, content }));
}

function formatGroqError(errorText: string, status: number): string {
  if (status === 413) {
    return "The request is too large for the AI model. Clear the chat and ask a shorter question.";
  }
  if (status === 429) {
    return "Rate limit reached. Wait a minute and try again.";
  }

  try {
    const outer = JSON.parse(errorText);
    const details = outer.details ?? outer.message ?? outer.error;
    if (typeof details === "string") {
      const innerMatch = details.match(/\{[\s\S]*\}/);
      if (innerMatch) {
        const inner = JSON.parse(innerMatch[0]);
        const msg = inner?.error?.message ?? inner?.message;
        if (typeof msg === "string") {
          if (/too large|413|token/i.test(msg)) {
            return "The request is too large for the AI model. Clear the chat and try again.";
          }
          return msg.length > 280 ? `${msg.slice(0, 280)}…` : msg;
        }
      }
      if (/too large|413|token/i.test(details)) {
        return "The request is too large for the AI model. Clear the chat and try again.";
      }
      return details.length > 280 ? `${details.slice(0, 280)}…` : details;
    }
  } catch {}

  const trimmed = errorText.trim();
  if (!trimmed) return "Something went wrong. Please try again.";
  return trimmed.length > 280 ? `${trimmed.slice(0, 280)}…` : trimmed;
}

function appendStreamChunk(prev: Message[], chunk: string): Message[] {
  if (!chunk) return prev;
  const last = prev[prev.length - 1];
  if (!last || last.role !== "assistant") return prev;
  return [
    ...prev.slice(0, -1),
    { ...last, content: last.content + chunk },
  ];
}

function parseSseLines(lines: string[], onChunk: (chunk: string) => void) {
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const parsed = JSON.parse(data);
      const content = parsed.choices?.[0]?.delta?.content;
      if (typeof content === "string" && content) {
        onChunk(content);
      }
    } catch {}
  }
}

export default function GroqQuery({ userId, apiBase }: GroqQueryProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [chatId, setChatId] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const getToken = useCallback(() => getStoredToken(), []);

  const scrollToBottom = useCallback(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading, scrollToBottom]);

  const saveChatHistory = useCallback(async (messagesToSave: Message[], chatIdToUse: string | null) => {
    try {
      const token = getToken();
      const finalChatId = chatIdToUse || crypto.randomUUID();
      await apiFetch(`${apiBase}/api/chat/history?userId=${userId}`, token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: messagesToSave.map(({ role, content }) => ({ role, content })),
          chatId: finalChatId,
        }),
      });
      if (!chatIdToUse) {
        setChatId(finalChatId);
      }
    } catch (error) {
      console.error("Failed to save chat history:", error);
    }
  }, [apiBase, userId, getToken]);

  const loadChatHistory = useCallback(async () => {
    setInitialLoading(false);
    setMessages([]);
    setChatId(null);
  }, []);

  useEffect(() => {
    if (!userId) {
      setInitialLoading(false);
      return;
    }
    setMessages([]);
    setChatId(null);
    setInitialLoading(true);
    loadChatHistory();
  }, [loadChatHistory, userId]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: input.trim(),
    };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput("");
    setLoading(true);

    saveChatHistory(updatedMessages, chatId).catch(() => {});

    const assistantId = `assistant-${Date.now()}`;

    try {
      const token = getToken();
      const apiMessages = messagesForGroqApi(updatedMessages);

      const response = await apiFetch(`${apiBase}/api/groq`, token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages,
          model: "openai/gpt-oss-120b",
          temperature: 0.7,
          max_completion_tokens: MAX_COMPLETION_TOKENS,
          top_p: 1,
          reasoning_effort: "low",
          stream: true,
          stop: null,
          userId,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        if (response.status === 401) {
          throw new Error("Unauthorized. Please refresh the page and try again.");
        }
        throw new Error(formatGroqError(errorText, response.status));
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: "" },
      ]);

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        parseSseLines(lines, (chunk) => {
          setMessages((prev) => appendStreamChunk(prev, chunk));
        });
      }

      if (buffer.trim()) {
        parseSseLines(buffer.split("\n"), (chunk) => {
          setMessages((prev) => appendStreamChunk(prev, chunk));
        });
      }

      setMessages((currentMessages) => {
        saveChatHistory(currentMessages, chatId).catch(() => {});
        return currentMessages;
      });
    } catch (error) {
      setMessages((prev) => {
        const cleaned = prev.filter((m) => m.id !== assistantId);
        const errorMessage: Message = {
          id: `error-${Date.now()}`,
          role: "assistant",
          isError: true,
          content:
            error instanceof Error
              ? error.message.includes("Unauthorized") || error.message.includes("401")
                ? "Authentication error. Please refresh the page and try again."
                : error.message
              : "Sorry, I encountered an error. Please try again.",
        };
        return [...cleaned, errorMessage];
      });
    } finally {
      setLoading(false);
    }
  }

  if (initialLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[480px] rounded-2xl surface-muted border border-black/10">
        <Loader2 className="h-8 w-8 animate-spin text-ink" />
        <p className="text-sm text-subtle mt-4">Loading AI assistant…</p>
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[480px] rounded-2xl surface-muted border border-black/10">
        <Bot className="h-12 w-12 text-ink" />
        <p className="text-sm text-subtle mt-4">No user selected</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-[480px] rounded-2xl border border-black/10 bg-white/75 overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-black/10 bg-white/90">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-black text-white">
          <Sparkles className="h-4 w-4" />
        </div>
        <div>
          <p className="text-sm font-semibold text-ink">AI Assistant</p>
          <p className="text-xs text-subtle">Ask about this user&apos;s finances</p>
        </div>
      </div>

      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto p-5 space-y-4 scroll-accent min-h-[320px] max-h-[420px]"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[280px] text-center space-y-4 py-12">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl surface-muted border border-black/10">
              <Bot className="h-7 w-7 text-ink" />
            </div>
            <div className="max-w-sm">
              <p className="text-base font-semibold text-ink">Ask AI about user data</p>
              <p className="text-sm text-subtle mt-2 leading-relaxed">
                Try questions like &quot;What are the top spending categories?&quot; or
                &quot;Summarize recent transactions.&quot;
              </p>
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex slide-in-from-bottom-4 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "assistant" && (
                <div className="mr-2 mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-black/5 border border-black/10">
                  <Bot className="h-3.5 w-3.5 text-ink" />
                </div>
              )}
              <div
                className={`max-w-[78%] rounded-2xl px-4 py-3 shadow-sm ${
                  msg.role === "user"
                    ? "bg-black text-white"
                    : msg.isError
                      ? "bg-rose-50 text-rose-800 border border-rose-200"
                      : "bg-white text-ink border border-black/10"
                }`}
              >
                {msg.role === "assistant" && !msg.isError ? (
                  <div className="groq-markdown text-sm leading-relaxed break-words">
                    {msg.content ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.content}
                      </ReactMarkdown>
                    ) : (
                      <span className="inline-flex items-center gap-2 text-subtle">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Thinking…
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{msg.content}</p>
                )}
              </div>
            </div>
          ))
        )}
        {loading && messages[messages.length - 1]?.role !== "assistant" && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-black/10 bg-white px-4 py-3 shadow-sm">
              <Loader2 className="h-5 w-5 animate-spin text-ink" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="border-t border-black/10 bg-white/90 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-xs text-subtle">Powered by Groq · answers use live user data</p>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setMessages([]);
                setChatId(null);
                setInput("");
              }}
              className="pill px-3 py-1 text-xs text-subtle hover:text-ink"
            >
              Clear chat
            </button>
          )}
        </div>
        <div className="flex gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about user data…"
            className="input-field flex-1 rounded-2xl px-4 py-3 text-sm outline-none"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="button-primary rounded-2xl font-semibold px-6 py-3 text-sm disabled:opacity-60 disabled:cursor-not-allowed glow-hover flex items-center gap-2"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </form>
    </div>
  );
}
