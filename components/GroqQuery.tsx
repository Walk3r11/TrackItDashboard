"use client";

import { useState, useRef, useEffect, useCallback } from "react";
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
  const [chatId, setChatId] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const optimisticUserMessageRef = useRef<string | null>(null);
  const optimisticAssistantMessageRef = useRef<string | null>(null);
  const getToken = useCallback(() => {
    if (typeof window === "undefined") return null;
    const stored = window.localStorage.getItem("trackit_dashboard_token");
    if (stored) return stored;
    const cookieToken = document.cookie
      .split("; ")
      .find((row) => row.startsWith("auth-token="))
      ?.split("=")[1];
    return cookieToken ?? null;
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const saveChatHistory = useCallback(async (messagesToSave: Message[], chatIdToUse: string | null) => {
    try {
      const token = getToken();

      const finalChatId = chatIdToUse || crypto.randomUUID();
      
      await fetch(`${apiBase}/api/chat/history?userId=${userId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          messages: messagesToSave,
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

    const userMessage: Message = { role: "user", content: input.trim() };
    const userMessageId = `user-${Date.now()}-${Math.random()}`;
    optimisticUserMessageRef.current = userMessageId;
    
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput("");
    setLoading(true);

    saveChatHistory(updatedMessages, chatId).catch(() => {
    });

    try {
      const token = getToken();

      const response = await fetch(`${apiBase}/api/groq`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          messages: updatedMessages,
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
        if (response.status === 401) {
          throw new Error("Unauthorized. Please refresh the page and try again.");
        }
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
      const assistantMessageId = `assistant-${Date.now()}-${Math.random()}`;
      optimisticAssistantMessageRef.current = assistantMessageId;
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

      setMessages((currentMessages) => {
        saveChatHistory(currentMessages, chatId).catch(() => {
        });
        return currentMessages;
      });

      optimisticUserMessageRef.current = null;
      optimisticAssistantMessageRef.current = null;
    } catch (error) {
      setMessages((prev) => {
        let rolledBack = [...prev];
        
        if (optimisticAssistantMessageRef.current) {
          const assistantIndex = rolledBack.findIndex(
            (msg, idx) => idx === rolledBack.length - 1 && msg.role === "assistant" && msg.content === ""
          );
          if (assistantIndex !== -1) {
            rolledBack = rolledBack.slice(0, assistantIndex);
          }
          optimisticAssistantMessageRef.current = null;
        }

        if (optimisticUserMessageRef.current) {
          const userIndex = rolledBack.findIndex(
            (msg, idx) => idx === rolledBack.length - 1 && msg.role === "user"
          );
          if (userIndex !== -1 && userIndex === rolledBack.length - 1) {
            rolledBack = rolledBack.slice(0, userIndex);
          }
          optimisticUserMessageRef.current = null;
        }

        const errorMessage: Message = {
          role: "assistant",
          content: error instanceof Error 
            ? (error.message.includes("Unauthorized") || error.message.includes("401"))
              ? "Authentication error. Please refresh the page and try again."
              : `Error: ${error.message}`
            : "Sorry, I encountered an error. Please try again.",
        };
        return [...rolledBack, errorMessage];
      });
    } finally {
      setLoading(false);
    }
  }

  if (initialLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full min-h-[500px]">
        <Loader2 className="h-8 w-8 animate-spin text-ink" />
        <p className="text-sm text-subtle mt-4">Loading chat history...</p>
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full min-h-[500px]">
        <Bot className="h-12 w-12 text-ink" />
        <p className="text-sm text-subtle mt-4">No user selected</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full min-h-[500px]">
      <div className="flex-1 overflow-y-auto space-y-4 p-4 scroll-accent min-h-[400px]">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center space-y-4 py-20">
            <Bot className="h-12 w-12 text-ink" />
            <div>
              <p className="text-lg font-semibold text-ink">
                Ask AI about user data
              </p>
              <p className="text-sm text-subtle mt-2">
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
                    ? "bg-black text-white"
                    : "bg-white/85 border border-black/10 text-ink"
                }`}
              >
                {msg.role === "assistant" ? (
                  <div className="text-sm text-ink [&_br]:block [&_br]:leading-4">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeRaw]}
                      components={{
                        h1: ({ node, ...props }) => <h1 className="text-lg font-bold mb-2 mt-3 first:mt-0 text-ink" {...props} />,
                        h2: ({ node, ...props }) => <h2 className="text-base font-bold mb-2 mt-3 first:mt-0 text-ink" {...props} />,
                        h3: ({ node, ...props }) => <h3 className="text-sm font-bold mb-1 mt-2 first:mt-0 text-ink" {...props} />,
                        p: ({ node, ...props }) => <p className="mb-2 last:mb-0 text-ink leading-relaxed" {...props} />,
                        strong: ({ node, ...props }) => <strong className="font-semibold text-ink" {...props} />,
                        em: ({ node, ...props }) => <em className="italic text-ink" {...props} />,
                        code: ({ node, inline, ...props }: any) =>
                          inline ? (
                            <code className="bg-black/5 text-ink px-1.5 py-0.5 rounded text-xs font-mono" {...props} />
                          ) : (
                            <code className="block bg-black/5 border border-black/10 rounded p-2 overflow-x-auto text-xs font-mono mb-2" {...props} />
                          ),
                        pre: ({ node, ...props }) => (
                          <pre className="bg-black/5 border border-black/10 rounded p-2 overflow-x-auto mb-2 text-xs" {...props} />
                        ),
                        ul: ({ node, ...props }) => <ul className="list-disc list-inside mb-2 space-y-1 text-ink ml-2" {...props} />,
                        ol: ({ node, ...props }) => <ol className="list-decimal list-inside mb-2 space-y-1 text-ink ml-2" {...props} />,
                        li: ({ node, ...props }) => <li className="text-ink" {...props} />,
                        blockquote: ({ node, ...props }) => (
                          <blockquote className="border-l-4 border-black/20 pl-3 italic text-muted my-2" {...props} />
                        ),
                        a: ({ node, ...props }) => (
                          <a className="text-ink underline hover:text-black/70" target="_blank" rel="noopener noreferrer" {...props} />
                        ),
                        table: ({ node, ...props }) => (
                          <div className="overflow-x-auto my-3">
                            <table className="min-w-full border-collapse border border-black/10" {...props} />
                          </div>
                        ),
                        thead: ({ node, ...props }) => <thead className="bg-black/5" {...props} />,
                        tbody: ({ node, ...props }) => <tbody {...props} />,
                        tr: ({ node, ...props }) => <tr className="border-b border-black/10 hover:bg-black/5" {...props} />,
                        th: ({ node, ...props }) => (
                          <th className="border border-black/10 px-3 py-2 text-left font-semibold text-ink" {...props} />
                        ),
                        td: ({ node, ...props }) => (
                          <td className="border border-black/10 px-3 py-2 text-ink [&_br]:block [&_br]:mb-1" {...props} />
                        ),
                        hr: ({ node, ...props }) => <hr className="border-black/10 my-3" {...props} />,
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
            <div className="bg-white/85 border border-black/10 rounded-2xl px-4 py-3">
              <Loader2 className="h-5 w-5 animate-spin text-ink" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="border-t border-black/10 p-4">
        <div className="flex gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about user data..."
            className="input-field flex-1 rounded-2xl px-4 py-3 text-sm outline-none"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="button-primary rounded-2xl font-semibold px-6 py-3 text-sm disabled:opacity-60 disabled:cursor-not-allowed glow-hover flex items-center gap-2"
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
