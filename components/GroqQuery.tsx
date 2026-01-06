"use client";

import { useState, useRef, useEffect } from "react";
import { Bot, Send, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type GroqQueryProps = {
  userId: string;
  apiBase: string;
};

export default function GroqQuery({ userId, apiBase }: GroqQueryProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage: Message = { role: "user", content: input.trim() };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const token = document.cookie
        .split("; ")
        .find((row) => row.startsWith("auth-token="))
        ?.split("=")[1];

      const response = await fetch(`${apiBase}/api/groq`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify({
          messages: [...messages, userMessage],
          model: "openai/gpt-oss-120b",
          temperature: 1,
          max_completion_tokens: 8192,
          top_p: 1,
          reasoning_effort: "medium",
          stream: true,
          stop: null,
          userId: userId,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        throw new Error(`Failed to get response: ${errorText}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      
      if (!reader) {
        throw new Error("No response body");
      }

      const assistantMessage: Message = {
        role: "assistant",
        content: "",
      };
      setMessages((prev) => [...prev, assistantMessage]);

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") continue;
            
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content || "";
              if (content) {
                setMessages((prev) => {
                  const newMessages = [...prev];
                  const lastMessage = newMessages[newMessages.length - 1];
                  if (lastMessage.role === "assistant") {
                    lastMessage.content += content;
                  }
                  return newMessages;
                });
              }
            } catch (e) {
            }
          }
        }
      }

      if (buffer.trim()) {
        const lines = buffer.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") continue;
            
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content || "";
              if (content) {
                setMessages((prev) => {
                  const newMessages = [...prev];
                  const lastMessage = newMessages[newMessages.length - 1];
                  if (lastMessage.role === "assistant") {
                    lastMessage.content += content;
                  }
                  return newMessages;
                });
              }
            } catch (e) {
            }
          }
        }
      }
    } catch (error) {
      const errorMessage: Message = {
        role: "assistant",
        content: error instanceof Error 
          ? `Error: ${error.message}` 
          : "Sorry, I encountered an error. Please try again.",
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto space-y-4 p-4 scroll-accent">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
            <Bot className="h-12 w-12 text-cyan-300" />
            <div>
              <p className="text-lg font-semibold text-slate-200">
                Ask AI about user data
              </p>
              <p className="text-sm text-slate-400 mt-2">
                Ask questions about the user&apos;s transactions, spending patterns, categories, and financial data.
              </p>
            </div>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                  msg.role === "user"
                    ? "bg-gradient-to-r from-cyan-300 to-sky-400 text-slate-900"
                    : "bg-white/5 border border-white/10 text-slate-200"
                }`}
              >
                {msg.role === "assistant" ? (
                  <div className="text-sm text-slate-200 [&_br]:block [&_br]:leading-4">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeRaw]}
                      components={{
                        h1: ({ node, ...props }) => <h1 className="text-lg font-bold mb-2 mt-3 first:mt-0 text-slate-200" {...props} />,
                        h2: ({ node, ...props }) => <h2 className="text-base font-bold mb-2 mt-3 first:mt-0 text-slate-200" {...props} />,
                        h3: ({ node, ...props }) => <h3 className="text-sm font-bold mb-1 mt-2 first:mt-0 text-slate-200" {...props} />,
                        p: ({ node, ...props }) => <p className="mb-2 last:mb-0 text-slate-200 leading-relaxed" {...props} />,
                        strong: ({ node, ...props }) => <strong className="font-semibold text-slate-100" {...props} />,
                        em: ({ node, ...props }) => <em className="italic text-slate-200" {...props} />,
                        code: ({ node, inline, ...props }: any) =>
                          inline ? (
                            <code className="bg-white/10 text-cyan-300 px-1.5 py-0.5 rounded text-xs font-mono" {...props} />
                          ) : (
                            <code className="block bg-white/5 border border-white/10 rounded p-2 overflow-x-auto text-xs font-mono mb-2" {...props} />
                          ),
                        pre: ({ node, ...props }) => (
                          <pre className="bg-white/5 border border-white/10 rounded p-2 overflow-x-auto mb-2 text-xs" {...props} />
                        ),
                        ul: ({ node, ...props }) => <ul className="list-disc list-inside mb-2 space-y-1 text-slate-200 ml-2" {...props} />,
                        ol: ({ node, ...props }) => <ol className="list-decimal list-inside mb-2 space-y-1 text-slate-200 ml-2" {...props} />,
                        li: ({ node, ...props }) => <li className="text-slate-200" {...props} />,
                        blockquote: ({ node, ...props }) => (
                          <blockquote className="border-l-4 border-slate-600 pl-3 italic text-slate-300 my-2" {...props} />
                        ),
                        a: ({ node, ...props }) => (
                          <a className="text-cyan-300 hover:text-cyan-200 underline" target="_blank" rel="noopener noreferrer" {...props} />
                        ),
                        table: ({ node, ...props }) => (
                          <div className="overflow-x-auto my-3">
                            <table className="min-w-full border-collapse border border-white/20" {...props} />
                          </div>
                        ),
                        thead: ({ node, ...props }) => <thead className="bg-white/10" {...props} />,
                        tbody: ({ node, ...props }) => <tbody {...props} />,
                        tr: ({ node, ...props }) => <tr className="border-b border-white/20 hover:bg-white/5" {...props} />,
                        th: ({ node, ...props }) => (
                          <th className="border border-white/20 px-3 py-2 text-left font-semibold text-slate-200" {...props} />
                        ),
                        td: ({ node, ...props }) => (
                          <td className="border border-white/20 px-3 py-2 text-slate-200 [&_br]:block [&_br]:mb-1" {...props} />
                        ),
                        hr: ({ node, ...props }) => <hr className="border-white/20 my-3" {...props} />,
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                )}
              </div>
            </div>
          ))
        )}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
              <Loader2 className="h-5 w-5 animate-spin text-cyan-300" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="border-t border-white/10 p-4">
        <div className="flex gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about user data..."
            className="flex-1 rounded-2xl bg-white/5 border border-white/15 px-4 py-3 text-sm text-slate-200 outline-none focus:border-cyan-300/60 focus:bg-white/10"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="rounded-2xl bg-gradient-to-r from-cyan-300 to-sky-400 text-slate-900 font-semibold px-6 py-3 text-sm shadow-lg shadow-cyan-500/30 disabled:opacity-60 disabled:cursor-not-allowed glow-hover flex items-center gap-2"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
      </form>
    </div>
  );
}