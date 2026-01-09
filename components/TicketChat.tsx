"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { X, Send, Lock } from "lucide-react";
import { usePusher } from "@/lib/usePusher";

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
  ticketStatus: "open" | "pending" | "closed";
  userId: string;
  onClose: () => void;
  apiBase: string;
  onStatusChange: (status: "open" | "pending" | "closed") => void;
};

export default function TicketChat({
  ticketId,
  ticketSubject,
  ticketStatus: initialStatus,
  userId,
  onClose,
  apiBase,
  onStatusChange,
}: TicketChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [ticketStatus, setTicketStatus] = useState<"open" | "pending" | "closed">(initialStatus);
  const [isClosingTicket, setIsClosingTicket] = useState(false);
  const [isOpeningTicket, setIsOpeningTicket] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const tempMessageIdsRef = useRef<Set<string>>(new Set());
  const processedMessageIdsRef = useRef<Set<string>>(new Set());
  
  const token = typeof document !== "undefined" 
    ? document.cookie.split("; ").find((row) => row.startsWith("auth-token="))?.split("=")[1] 
    : "";

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
      const loadedMessages = body.messages ?? [];
      setMessages(loadedMessages);
      loadedMessages.forEach((msg: Message) => {
        processedMessageIdsRef.current.add(msg.id);
      });
    } catch (err) {
      setError("Failed to load messages");
    } finally {
      setLoading(false);
    }
  }, [apiBase, ticketId, userId]);

  const handlePusherMessage = useCallback((message: any) => {
    if (message.type === "message" && message.message) {
      const messageId = message.message.id;
      
      if (processedMessageIdsRef.current.has(messageId)) {
        return;
      }

      processedMessageIdsRef.current.add(messageId);

      setMessages((prev) => {
        const existsById = prev.some((m) => m.id === messageId);
        if (existsById) {
          return prev;
        }
        
        const duplicateByContent = prev.some((m) => 
          m.content === message.message.content &&
          m.sender_type === message.message.sender_type &&
          Math.abs(new Date(m.created_at).getTime() - new Date(message.message.created_at).getTime()) < 3000
        );
        if (duplicateByContent) {
          return prev;
        }
        
        const tempIndex = prev.findIndex((m) => 
          tempMessageIdsRef.current.has(m.id) && 
          m.content === message.message.content &&
          m.sender_type === message.message.sender_type &&
          Math.abs(new Date(m.created_at).getTime() - new Date(message.message.created_at).getTime()) < 5000
        );
        
        if (tempIndex !== -1) {
          const updated = [...prev];
          updated[tempIndex] = message.message;
          tempMessageIdsRef.current.delete(prev[tempIndex].id);
          return updated;
        }
        
        return [...prev, message.message];
      });
    } else if (message.type === "status" && message.status) {
      setTicketStatus(message.status);
      onStatusChange(message.status);
    }
  }, [onStatusChange]);

  usePusher({
    apiBase,
    token: token || "",
    userId,
    supportUserId: userId,
    streamType: "ticket-messages",
    ticketId,
    onMessage: handlePusherMessage,
    onError: (err) => console.error("Pusher error:", err),
  });

  useEffect(() => {
    setTicketStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    processedMessageIdsRef.current.clear();
    tempMessageIdsRef.current.clear();
    loadMessages();
  }, [loadMessages]);

  const scrollToBottom = useCallback((force = false) => {
    if (messagesContainerRef.current) {
      const container = messagesContainerRef.current;
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
      
      if (force || isNearBottom) {
        setTimeout(() => {
          if (messagesContainerRef.current) {
            messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
          }
        }, 100);
      }
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (!loading && messages.length > 0) {
      setTimeout(() => {
        scrollToBottom(true);
      }, 200);
    }
  }, [loading, messages.length, scrollToBottom]);

  async function sendMessage() {
    const text = inputText.trim();
    if (!text || sending || ticketStatus !== "open") return;

    const tempId = `temp-${Date.now()}-${Math.random()}`;
    const tempMessage: Message = {
      id: tempId,
      ticket_id: ticketId,
      user_id: userId,
      sender_type: "support",
      content: text,
      created_at: new Date().toISOString(),
    };
    
    tempMessageIdsRef.current.add(tempId);
    setMessages((prev) => [...prev, tempMessage]);
    setInputText("");
    setSending(true);
    setError(null);
    
    setTimeout(() => scrollToBottom(true), 50);

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
        const messageId = body.message.id;
        
        processedMessageIdsRef.current.add(messageId);
        
        setMessages((prev) => {
          const alreadyExists = prev.some((m) => m.id === messageId);
          if (alreadyExists) {
            return prev;
          }
          
          const tempIndex = prev.findIndex((m) => m.id === tempId);
          if (tempIndex !== -1) {
            const updated = [...prev];
            updated[tempIndex] = body.message;
            tempMessageIdsRef.current.delete(tempId);
            return updated;
          }
          
          const duplicateByContent = prev.some((m) => 
            m.content === body.message.content &&
            m.sender_type === body.message.sender_type &&
            Math.abs(new Date(m.created_at).getTime() - new Date(body.message.created_at).getTime()) < 2000
          );
          if (duplicateByContent) {
            return prev;
          }
          
          return [...prev, body.message];
        });
      }
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      tempMessageIdsRef.current.delete(tempId);
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

  async function openTicket() {
    if (isOpeningTicket || ticketStatus !== "pending") return;
    
    setIsOpeningTicket(true);
    setError(null);
    
    try {
      const token = document.cookie
        .split("; ")
        .find((row) => row.startsWith("auth-token="))
        ?.split("=")[1];

      const res = await fetch(
        `${apiBase}/api/tickets/${ticketId}/status`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          credentials: "include",
          body: JSON.stringify({
            status: "open",
          }),
        }
      );

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Failed to open ticket");
      }

      setTicketStatus("open");
      onStatusChange("open");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open ticket");
    } finally {
      setIsOpeningTicket(false);
    }
  }

  async function closeTicket() {
    if (isClosingTicket || ticketStatus === "closed") return;
    
    setIsClosingTicket(true);
    setError(null);
    
    try {
      const token = document.cookie
        .split("; ")
        .find((row) => row.startsWith("auth-token="))
        ?.split("=")[1];

      const res = await fetch(
        `${apiBase}/api/tickets/${ticketId}/status`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          credentials: "include",
          body: JSON.stringify({
            status: "closed",
          }),
        }
      );

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Failed to close ticket");
      }

      setTicketStatus("closed");
      onStatusChange("closed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to close ticket");
    } finally {
      setIsClosingTicket(false);
    }
  }

  return (
    <div className={`fixed inset-0 z-[9999] flex items-center justify-center p-4 ${isClosing ? 'fade-out' : 'fade-in'}`} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, width: '100vw', height: '100vh' }}>
      <div
        className={`absolute inset-0 bg-black/40 backdrop-blur-2xl ${isClosing ? 'fade-out' : 'fade-in'}`}
        onClick={handleClose}
        style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }}
      />
      <div className={`relative z-10 w-full max-w-2xl h-[80vh] flex flex-col backdrop-blur-3xl border border-white/30 rounded-3xl shadow-2xl ${isClosing ? 'zoom-out-95' : 'zoom-in-95'}`} style={{ background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.8) 100%)' }}>
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-semibold text-slate-100">
                {ticketSubject}
              </h2>
              <span className={`px-3 py-1 rounded-xl text-xs font-medium ${
                ticketStatus === 'open' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' :
                ticketStatus === 'pending' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
                'bg-slate-500/20 text-slate-400 border border-slate-500/30'
              }`}>
                {ticketStatus.toUpperCase()}
              </span>
            </div>
            <p className="text-sm text-slate-400 mt-1">Ticket #{ticketId.slice(0, 8)}</p>
          </div>
          <div className="flex items-center gap-2">
            {ticketStatus === "pending" && (
              <button
                onClick={openTicket}
                disabled={isOpeningTicket}
                className="px-4 py-2 rounded-xl bg-slate-700 hover:bg-cyan-600/80 text-slate-200 hover:text-white text-sm font-medium transition-all duration-200 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed border border-slate-600/50 hover:border-cyan-500/50"
              >
                {isOpeningTicket ? "Opening..." : "Open Ticket"}
              </button>
            )}
            <button
              onClick={handleClose}
              className="p-2 rounded-xl hover:bg-white/10 transition-all duration-200 hover:scale-110 active:scale-95"
            >
              <X className="h-5 w-5 text-slate-400" />
            </button>
          </div>
        </div>

        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-6 space-y-4 scroll-accent">
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
          {ticketStatus !== "open" ? (
            <div className="flex items-center gap-3 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20">
              <Lock className="h-5 w-5 text-amber-400" />
              <div className="flex-1">
                <p className="text-sm font-medium text-amber-300">
                  {ticketStatus === "closed" 
                    ? "This ticket is closed." 
                    : "This ticket is pending. Use the 'Open Ticket' button above to enable messaging."}
                </p>
              </div>
            </div>
          ) : (
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
                disabled={sending || ticketStatus !== "open"}
              />
              <button
                onClick={sendMessage}
                disabled={!inputText.trim() || sending || ticketStatus !== "open"}
                className="px-6 py-3 rounded-2xl bg-gradient-to-r from-cyan-300 to-sky-400 text-slate-900 font-semibold text-sm shadow-lg shadow-cyan-500/30 disabled:opacity-60 disabled:cursor-not-allowed hover:shadow-cyan-500/40 hover:scale-105 active:scale-95 transition-all duration-200"
              >
                {sending ? (
                  "Sending..."
                ) : (
                  <Send className="h-5 w-5" />
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
