"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { X, Send, Lock } from "lucide-react";
import { useWebSocket } from "@/lib/useWebSocket";
import { apiFetch, getStoredToken } from "@/lib/dashboard-api";

type Message = {
  id: string;
  ticket_id: string;
  user_id: string | null;
  sender_type: "user" | "support";
  content: string;
  created_at: string;
  read_by_user_at?: string | null;
  read_by_support_at?: string | null;
};

type TicketChatProps = {
  ticketId: string;
  ticketSubject: string;
  ticketStatus: "open" | "pending" | "closed";
  userId: string;
  authToken?: string | null;
  onClose: () => void;
  apiBase: string;
  onStatusChange: (status: "open" | "pending" | "closed") => void;
};

export default function TicketChat({
  ticketId,
  ticketSubject,
  ticketStatus: initialStatus,
  userId,
  authToken,
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
  
  const token = authToken ?? getStoredToken() ?? "";

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 300);
  };

  const markReadSupport = useCallback(async () => {
    if (!ticketId || !userId || !token) return;
    try {
      await apiFetch(
        `${apiBase}/api/tickets/${ticketId}/messages/read?supportUserId=${userId}&reader=support`,
        token,
        { method: "POST" }
      );
    } catch (err) {
    }
  }, [apiBase, ticketId, userId, token]);

  const loadMessages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(
        `${apiBase}/api/tickets/${ticketId}/messages?supportUserId=${userId}`,
        token
      );
      if (!res.ok) throw new Error("Failed to load messages");
      const body = await res.json();
      const loadedMessages = body.messages ?? [];
      setMessages(loadedMessages);
      loadedMessages.forEach((msg: Message) => {
        processedMessageIdsRef.current.add(msg.id);
      });
      await markReadSupport();
    } catch (err) {
      setError("Failed to load messages");
    } finally {
      setLoading(false);
    }
  }, [apiBase, ticketId, userId, token, markReadSupport]);

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

  const handleWebSocketMessage = useCallback((message: any) => {
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
          m.id === messageId || (
            m.content === message.message.content &&
            m.sender_type === message.message.sender_type &&
            Math.abs(new Date(m.created_at).getTime() - new Date(message.message.created_at).getTime()) < 2000
          )
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
      
      setTimeout(() => scrollToBottom(true), 50);
      if (message.message.sender_type === "user") {
        markReadSupport();
      }
    } else if (message.type === "status" && message.status) {
      setTicketStatus(message.status);
      onStatusChange(message.status);
    }
  }, [onStatusChange, scrollToBottom]);

  useWebSocket({
    apiBase,
    token: token || "",
    userId,
    supportUserId: userId,
    streamType: "ticket-messages",
    ticketId,
    onMessage: handleWebSocketMessage,
    onError: (err) => {
      setError(`Connection error: ${err}`);
    },
  });

  useEffect(() => {
    setTicketStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    processedMessageIdsRef.current.clear();
    tempMessageIdsRef.current.clear();
    loadMessages();
  }, [loadMessages]);

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
      const res = await apiFetch(
        `${apiBase}/api/tickets/${ticketId}/messages?supportUserId=${userId}`,
        token,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
      const res = await apiFetch(`${apiBase}/api/tickets/${ticketId}/status`, token, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "open" }),
      });

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
      const res = await apiFetch(`${apiBase}/api/tickets/${ticketId}/status`, token, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "closed" }),
      });

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
        className={`absolute inset-0 bg-black/25 backdrop-blur-2xl ${isClosing ? 'fade-out' : 'fade-in'}`}
        onClick={handleClose}
        style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }}
      />
      <div className={`relative z-10 w-full max-w-2xl h-[80vh] flex flex-col rounded-3xl shadow-2xl border border-black/10 bg-white/90 backdrop-blur-3xl ${isClosing ? 'zoom-out-95' : 'zoom-in-95'}`}>
        <div className="flex items-center justify-between p-6 border-b border-black/10">
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-semibold text-ink">
                {ticketSubject}
              </h2>
              <span className={`px-3 py-1 rounded-xl text-xs font-medium ${
                ticketStatus === 'open' ? 'badge badge-open' :
                ticketStatus === 'pending' ? 'badge badge-pending' :
                'badge badge-closed'
              }`}>
                {ticketStatus.toUpperCase()}
              </span>
            </div>
            <p className="text-sm text-subtle mt-1">Ticket #{ticketId.slice(0, 8)}</p>
          </div>
          <div className="flex items-center gap-2">
            {ticketStatus === "pending" && (
              <button
                onClick={openTicket}
                disabled={isOpeningTicket}
                className="button-secondary px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isOpeningTicket ? "Opening..." : "Open Ticket"}
              </button>
            )}
            {ticketStatus === "open" && (
              <button
                onClick={closeTicket}
                disabled={isClosingTicket}
                className="px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed bg-rose-100 text-rose-700 hover:bg-rose-200 border border-rose-200"
              >
                {isClosingTicket ? "Closing..." : "Close Ticket"}
              </button>
            )}
            <button
              onClick={handleClose}
              className="p-2 rounded-xl hover:bg-black/5 transition-all duration-200 hover:scale-110 active:scale-95"
            >
              <X className="h-5 w-5 text-subtle" />
            </button>
          </div>
        </div>

        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-6 space-y-4 scroll-accent">
          {loading ? (
            <div className="text-center text-subtle py-8">Loading messages...</div>
          ) : messages.length === 0 ? (
            <div className="text-center text-subtle py-8">
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
                      ? "bg-black text-white"
                      : "bg-white/85 text-ink border border-black/10"
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  <p
                    className={`text-xs mt-2 ${
                      message.sender_type === "support"
                        ? "text-white/80"
                        : "text-subtle"
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
          <div className="px-6 py-2 bg-rose-50 border-t border-rose-200">
            <p className="text-sm text-rose-700">{error}</p>
          </div>
        )}

        <div className="p-6 border-t border-black/10">
          {ticketStatus !== "open" ? (
            <div className="flex items-center gap-3 p-4 rounded-2xl bg-amber-50 border border-amber-200">
              <Lock className="h-5 w-5 text-amber-600" />
              <div className="flex-1">
                <p className="text-sm font-medium text-amber-700">
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
                className="input-field flex-1 rounded-2xl px-4 py-3 text-sm outline-none transition-all duration-300 focus:scale-[1.02]"
                disabled={sending || ticketStatus !== "open"}
              />
              <button
                onClick={sendMessage}
                disabled={!inputText.trim() || sending || ticketStatus !== "open"}
                className="button-primary px-6 py-3 rounded-2xl font-semibold text-sm disabled:opacity-60 disabled:cursor-not-allowed hover:scale-105 active:scale-95 transition-all duration-200"
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
