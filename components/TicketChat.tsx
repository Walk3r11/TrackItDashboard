"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { X, Send } from "lucide-react";

type Message = {
  id: string;
  ticket_id: string;
  user_id: string | null;
  sender_type: "user" | "support";
  content: string;
  created_at: string;
};

type TicketChatProps = {
  ticketId: string;
  ticketSubject: string;
  userId: string;
  onClose: () => void;
  apiBase: string;
};

export default function TicketChat({
  ticketId,
  ticketSubject,
  userId,
  onClose,
  apiBase,
}: TicketChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 300);
  };

  const loadMessages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiBase}/api/tickets/${ticketId}/messages?supportUserId=${userId}`,
        {
          cache: "no-store",
        }
      );
      if (!res.ok) throw new Error("Failed to load messages");
      const body = await res.json();
      setMessages(body.messages ?? []);
    } catch (err) {
      setError("Failed to load messages");
    } finally {
      setLoading(false);
    }
  }, [apiBase, ticketId, userId]);

  const startSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const token = document.cookie
      .split("; ")
      .find((row) => row.startsWith("auth-token="))
      ?.split("=")[1];

    const url = `${apiBase}/api/tickets/${ticketId}/messages/stream?supportUserId=${userId}${token ? `&token=${encodeURIComponent(token)}` : ""}`;
    const eventSource = new EventSource(url, {
      withCredentials: true,
    });

    eventSource.onmessage = (event) => {
      try {
        if (!event.data || event.data.trim() === "" || event.data.startsWith(":")) {
          return;
        }
        const data = JSON.parse(event.data);
        if (data.type === "message" && data.message) {
          setMessages((prev) => {
            const exists = prev.some((m) => m.id === data.message.id);
            if (exists) return prev;
            return [...prev, data.message];
          });
        } else if (data.type === "error") {
          console.error("SSE error:", data.error);
        } else if (data.type === "connected") {
        }
      } catch (err) {
      }
    };

    eventSource.onerror = () => {
      if (eventSource.readyState === EventSource.CLOSED || eventSource.readyState === EventSource.CONNECTING) {
        eventSource.close();
        setTimeout(() => {
          if (eventSourceRef.current === eventSource) {
            startSSE();
          }
        }, 500);
      }
    };

    eventSourceRef.current = eventSource;
  }, [apiBase, ticketId, userId]);

  useEffect(() => {
    loadMessages();
    startSSE();
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [loadMessages, startSSE]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage() {
    const text = inputText.trim();
    if (!text || sending) return;

    setSending(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiBase}/api/tickets/${ticketId}/messages?supportUserId=${userId}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            content: text,
            senderType: "support",
          }),
        }
      );

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Failed to send message");
      }

      const body = await res.json();
      if (body.message) {
        setMessages((prev) => [...prev, body.message]);
      }
      setInputText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  }

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      month: "short",
      day: "numeric",
    }).format(date);
  };

  return (
    <div className={`fixed inset-0 z-[9999] flex items-center justify-center p-4 ${isClosing ? 'fade-out' : 'fade-in'}`} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, width: '100vw', height: '100vh' }}>
      <div
        className={`absolute inset-0 bg-black/40 backdrop-blur-2xl ${isClosing ? 'fade-out' : 'fade-in'}`}
        onClick={handleClose}
        style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }}
      />
      <div className={`relative z-10 w-full max-w-2xl h-[80vh] flex flex-col backdrop-blur-3xl border border-white/30 rounded-3xl shadow-2xl ${isClosing ? 'zoom-out-95' : 'zoom-in-95'}`} style={{ background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.8) 100%)' }}>
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <div>
            <h2 className="text-xl font-semibold text-slate-100">
              {ticketSubject}
            </h2>
            <p className="text-sm text-slate-400 mt-1">Ticket #{ticketId.slice(0, 8)}</p>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-xl hover:bg-white/10 transition-all duration-200 hover:scale-110 active:scale-95"
          >
            <X className="h-5 w-5 text-slate-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 scroll-accent">
          {loading ? (
            <div className="text-center text-slate-400 py-8">Loading messages...</div>
          ) : messages.length === 0 ? (
            <div className="text-center text-slate-400 py-8">
              No messages yet. Start the conversation!
            </div>
          ) : (
            messages.map((message, index) => (
              <div
                key={message.id}
                className={`flex slide-in-from-bottom-4 ${
                  message.sender_type === "support" ? "justify-end" : "justify-start"
                }`}
                style={{ animationDelay: `${Math.min(index * 50, 300)}ms` }}
              >
                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-3 transition-all duration-300 hover:scale-[1.02] ${
                    message.sender_type === "support"
                      ? "bg-gradient-to-r from-cyan-300 to-sky-400 text-slate-900"
                      : "bg-white/10 text-slate-100 border border-white/10"
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  <p
                    className={`text-xs mt-2 ${
                      message.sender_type === "support"
                        ? "text-slate-700"
                        : "text-slate-400"
                    }`}
                  >
                    {formatTime(message.created_at)}
                  </p>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {error && (
          <div className="px-6 py-2 bg-rose-500/20 border-t border-rose-500/30">
            <p className="text-sm text-rose-300">{error}</p>
          </div>
        )}

        <div className="p-6 border-t border-white/10">
          <div className="flex gap-3">
            <input
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Type your message..."
              className="flex-1 rounded-2xl bg-white/5 border border-white/15 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-300/60 focus:bg-white/10 transition-all duration-300 focus:scale-[1.02]"
              disabled={sending}
            />
            <button
              onClick={sendMessage}
              disabled={!inputText.trim() || sending}
              className="px-6 py-3 rounded-2xl bg-gradient-to-r from-cyan-300 to-sky-400 text-slate-900 font-semibold text-sm shadow-lg shadow-cyan-500/30 disabled:opacity-60 disabled:cursor-not-allowed hover:shadow-cyan-500/40 hover:scale-105 active:scale-95 transition-all duration-200"
            >
              {sending ? (
                "Sending..."
              ) : (
                <Send className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
