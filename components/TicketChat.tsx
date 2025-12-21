"use client";

import { useEffect, useRef, useState } from "react";
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    loadMessages();
    startPolling();
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [ticketId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function loadMessages() {
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
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function startPolling() {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }

    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(
          `${apiBase}/api/tickets/${ticketId}/messages?supportUserId=${userId}`,
          {
            cache: "no-store",
          }
        );
        if (res.ok) {
          const body = await res.json();
          const newMessages = body.messages ?? [];
          setMessages((prev) => {
            if (newMessages.length !== prev.length) {
              return newMessages;
            }
            const prevIds = new Set(prev.map((m) => m.id));
            const hasNew = newMessages.some((m: Message) => !prevIds.has(m.id));
            return hasNew ? newMessages : prev;
          });
        }
      } catch (err) {
        console.error("Error polling messages:", err);
      }
    }, 2000); // Poll every 2 seconds
  }

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
            senderType: "support", // Dashboard is always support
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-2xl h-[80vh] flex flex-col bg-slate-900/95 border border-white/10 rounded-3xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <div>
            <h2 className="text-xl font-semibold text-slate-100">
              {ticketSubject}
            </h2>
            <p className="text-sm text-slate-400 mt-1">Ticket #{ticketId.slice(0, 8)}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-white/10 transition-colors"
          >
            <X className="h-5 w-5 text-slate-400" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 scroll-accent">
          {loading ? (
            <div className="text-center text-slate-400 py-8">Loading messages...</div>
          ) : messages.length === 0 ? (
            <div className="text-center text-slate-400 py-8">
              No messages yet. Start the conversation!
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${
                  message.sender_type === "support" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-3 ${
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

        {/* Error */}
        {error && (
          <div className="px-6 py-2 bg-rose-500/20 border-t border-rose-500/30">
            <p className="text-sm text-rose-300">{error}</p>
          </div>
        )}

        {/* Input */}
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
              className="flex-1 rounded-2xl bg-white/5 border border-white/15 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-300/60 focus:bg-white/10"
              disabled={sending}
            />
            <button
              onClick={sendMessage}
              disabled={!inputText.trim() || sending}
              className="px-6 py-3 rounded-2xl bg-gradient-to-r from-cyan-300 to-sky-400 text-slate-900 font-semibold text-sm shadow-lg shadow-cyan-500/30 disabled:opacity-60 disabled:cursor-not-allowed hover:shadow-cyan-500/40 transition-shadow"
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
