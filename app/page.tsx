"use client";

import { ShieldCheck, Ticket, Users, Zap, LogOut, Bot } from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import TicketChat from "@/components/TicketChat";
import GroqQuery from "@/components/GroqQuery";
import { useWebSocket } from "@/lib/useWebSocket";

type User = {
  id: string;
  name: string;
  email: string;
  lastActive: string;
};

type TicketItem = {
  id: string;
  userId?: string;
  subject: string;
  status: "open" | "pending" | "closed";
  updatedAt: string;
  priority?: "low" | "medium" | "high";
};

type TransactionItem = {
  id: string;
  title: string;
  amount: number;
  date: string;
  type: "debit" | "credit";
  category?: string;
  categoryColor?: string;
};

type CardItem = {
  id: string;
  name: string;
  balance: number;
  limit: number;
  tags?: string[];
};

const dateLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "https://backend-production-0eac.up.railway.app";
const euroCutover = new Date("2026-01-01T00:00:00Z");
const bgnToEur = 1.95583;
const authStorageKey = "trackit_dashboard_token";

const buildAuthHeaders = (token: string | null, extra?: HeadersInit): HeadersInit => ({
  ...(extra ?? {}),
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

const getTransactionId = (tx: any): string | null => {
  if (!tx) return null;
  return tx.id ?? tx.transactionId ?? tx.transaction_id ?? tx.txId ?? null;
};

const normalizeTransaction = (tx: any): TransactionItem | null => {
  const id = getTransactionId(tx);
  if (!id) return null;
  const amount = typeof tx.amount === "number" ? tx.amount : Number(tx.amount ?? 0);
  return {
    id,
    title: tx.title ?? tx.category ?? tx.merchant ?? "Transaction",
    amount,
    date: tx.date ?? tx.createdAt ?? tx.created_at ?? tx.postedAt ?? new Date().toISOString(),
    type: tx.type ?? (amount >= 0 ? "credit" : "debit"),
    category: tx.category ?? tx.category_name ?? undefined,
    categoryColor: tx.categoryColor ?? tx.category_color ?? undefined
  };
};

export default function Page() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [tickets, setTickets] = useState<TicketItem[]>([]);
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [cards, setCards] = useState<CardItem[]>([]);
  const [ticketStatus, setTicketStatus] = useState<"all" | "open" | "pending" | "closed">("all");
  const [txRange, setTxRange] = useState<"all" | "1d" | "3d" | "7d" | "30d" | "90d" | "365d">("all");
  const [txQuery, setTxQuery] = useState("");
  const [selectedTicket, setSelectedTicket] = useState<{ id: string; subject: string; status: "open" | "pending" | "closed" } | null>(null);
  const [supportUser, setSupportUser] = useState<{ email: string } | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "tickets" | "groq" | "insights">("overview");
  const sectionElementRef = useRef<HTMLElement | null>(null);
  const [newTransactionCount, setNewTransactionCount] = useState(0);
  const [newTransactionUser, setNewTransactionUser] = useState<string | null>(null);
  const [newTransactionIds, setNewTransactionIds] = useState<Set<string>>(new Set());
  const [newestTransactionId, setNewestTransactionId] = useState<string | null>(null);
  const [isTabTransitioning, setIsTabTransitioning] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const userSectionRef = useRef<HTMLElement | null>(null);
  const getAuthToken = useCallback(() => {
    if (authToken) return authToken;
    if (typeof window === "undefined") return null;
    const stored = window.localStorage.getItem(authStorageKey);
    if (stored) return stored;
    const cookieToken = document.cookie
      .split("; ")
      .find((row) => row.startsWith("auth-token="))
      ?.split("=")[1];
    return cookieToken ?? null;
  }, [authToken]);

  useEffect(() => {
    const storedToken = getAuthToken();

    if (!storedToken) {
      setAuthLoading(false);
      router.push("/login");
      return;
    }

    setAuthToken(storedToken);

    fetch(`${apiBase}/api/auth/dashboard/session`, {
      headers: buildAuthHeaders(storedToken),
      cache: "no-store",
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated) {
          setSupportUser({ email: data.user.email });
          loadAllTickets(undefined, storedToken);
        } else {
          window.localStorage.removeItem(authStorageKey);
          setAuthToken(null);
          router.push("/login");
        }
      })
      .catch(() => {
        window.localStorage.removeItem(authStorageKey);
        setAuthToken(null);
        router.push("/login");
      })
      .finally(() => {
        setAuthLoading(false);
      });
  }, [router]);

  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = null;
    }
  }, [user?.id]);

  async function handleLogout() {
    const token = authToken ?? (typeof window !== "undefined" ? window.localStorage.getItem(authStorageKey) : null);
    await fetch(`${apiBase}/api/auth/dashboard/logout`, {
      method: "POST",
      headers: buildAuthHeaders(token),
    });
    window.localStorage.removeItem(authStorageKey);
    setAuthToken(null);
    router.push("/login");
    router.refresh();
  }

  async function handleSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const base = apiBase;
      const lookupUrl = `${base}/api/users/lookup?query=${encodeURIComponent(query.trim())}`;
      const res = await fetch(lookupUrl, {
        cache: "no-store",
        headers: buildAuthHeaders(getAuthToken()),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "User not found");
      }
      const body = await res.json();
      if (!body.user) {
        throw new Error("User not found. Please check the email or ID and try again.");
      }
      setUser(body.user);
      await Promise.all([
        loadTickets(body.user.id),
        loadTransactions(body.user.id),
        loadCards(body.user.id),
      ]);
      setActiveTab("overview");
      setNewTransactionCount(0);

      setTimeout(() => {
        if (userSectionRef.current) {
          userSectionRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 100);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "User not found. Please check the email or ID and try again.";
      setError(errorMessage);
      setUser(null);
      setTickets([]);
      setTransactions([]);
      setCards([]);
    } finally {
      setLoading(false);
    }
  }

  const loadAllTickets = useCallback(async (status?: string, tokenOverride?: string | null) => {
    try {
      const base = apiBase;
      const url = `${base}/api/tickets${status ? `?status=${status}` : ""}`;
      const res = await fetch(url, {
        cache: "no-store",
        headers: buildAuthHeaders(tokenOverride ?? getAuthToken()),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to load tickets");
      }
      const body = await res.json();
      const ticketsList = (body.tickets ?? []).map((t: any) => ({
        id: t.id,
        userId: t.userId || t.user_id,
        subject: t.subject,
        status: t.status,
        priority: t.priority,
        updatedAt: t.updatedAt || t.updated_at
      }));
      setTickets(ticketsList);
    } catch (err) {
      setTickets([]);
    }
  }, [getAuthToken]);

  const loadTickets = useCallback(async (userId: string) => {
    try {
      const base = apiBase;
      const url = new URL(`${base}/api/tickets`);
      url.searchParams.set("userId", userId);
      url.searchParams.set("ts", Date.now().toString());
      const res = await fetch(url, {
        cache: "no-store",
        headers: buildAuthHeaders(getAuthToken()),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to load tickets");
      }
      const body = await res.json();
      const ticketsList = (body.tickets ?? []).map((t: any) => ({
        id: t.id,
        userId: t.userId || t.user_id,
        subject: t.subject,
        status: t.status,
        priority: t.priority,
        updatedAt: t.updatedAt || t.updated_at
      }));
      setTickets(ticketsList);
    } catch (err) {
      setTickets([]);
    }
  }, [getAuthToken]);

  const loadTransactions = useCallback(async (userId: string) => {
    try {
      const base = apiBase;
      const url = new URL(`${base}/api/transactions`);
      url.searchParams.set("userId", userId);
      url.searchParams.set("ts", Date.now().toString());
      const res = await fetch(url, {
        cache: "no-store",
        headers: buildAuthHeaders(getAuthToken()),
      });
      if (!res.ok) throw new Error("Transactions request failed");
      const body = await res.json();
      const mapped = (body.transactions ?? [])
        .map((tx: any) => normalizeTransaction(tx))
        .filter((tx: TransactionItem | null): tx is TransactionItem => Boolean(tx));
      setTransactions(mapped);
    } catch (err) {
      setTransactions([]);
    }
  }, [getAuthToken]);

  const loadCards = useCallback(async (userId: string) => {
    try {
      const base = apiBase;
      const url = new URL(`${base}/api/cards`);
      url.searchParams.set("userId", userId);
      url.searchParams.set("ts", Date.now().toString());
      const res = await fetch(url, {
        cache: "no-store",
        headers: buildAuthHeaders(getAuthToken()),
      });
      if (!res.ok) throw new Error("Cards request failed");
      const body = await res.json();
      const toNumber = (val: any): number => {
        if (typeof val === "number") return val;
        const num = Number(val);
        return isNaN(num) ? 0 : num;
      };
      const mapped: CardItem[] = (body.cards ?? []).map((card: any) => ({
        id: card.id,
        name: card.nickname || "Card",
        balance: toNumber(card.balance),
        limit: toNumber(card.card_limit),
        tags: Array.isArray(card.tags) ? card.tags : undefined
      }));
      setCards(mapped);
    } catch (err) {
      setCards([]);
    }
  }, [getAuthToken]);

  const scheduleUserRefresh = useCallback((delay = 250) => {
    if (!user?.id) return;
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }
    refreshTimeoutRef.current = setTimeout(() => {
      refreshTimeoutRef.current = null;
      loadTickets(user.id);
      loadTransactions(user.id);
      loadCards(user.id);
    }, delay);
  }, [user?.id, loadTickets, loadTransactions, loadCards]);

  const handleTransactionMessage = useCallback((message: any) => {
    const type = typeof message?.type === "string" ? message.type : "";
    const isTransaction = type.startsWith("transaction") || type.startsWith("transactions");
    if (!isTransaction || !message.data) return;
    const payload = message.data?.transaction ?? message.data;
    const items = Array.isArray(payload) ? payload : [payload];
    const mappedItems = items
      .map((tx) => normalizeTransaction(tx))
      .filter((tx): tx is TransactionItem => Boolean(tx));
    if (!mappedItems.length) return;

    const newItems: TransactionItem[] = [];

    setTransactions((prev) => {
      const existingIds = new Set(prev.map((t) => t.id));
      mappedItems.forEach((tx) => {
        if (!existingIds.has(tx.id)) {
          newItems.push(tx);
          existingIds.add(tx.id);
        }
      });
      if (!newItems.length) return prev;
      return [...newItems, ...prev];
    });

    if (!newItems.length) return;

    setNewTransactionIds((ids) => {
      const newIds = new Set(ids);
      newItems.forEach((tx) => newIds.add(tx.id));
      setNewTransactionCount(newIds.size);
      setNewestTransactionId(newItems[0].id);
      newItems.forEach((tx) => {
        setTimeout(() => {
          setNewTransactionIds((currentIds) => {
            const nextIds = new Set(currentIds);
            nextIds.delete(tx.id);
            setNewTransactionCount(nextIds.size);
            setNewestTransactionId((currentNewest) => (
              currentNewest === tx.id ? null : currentNewest
            ));
            return nextIds;
          });
        }, 10000);
      });
      if (user) {
        setNewTransactionUser(user.name || user.email);
        setTimeout(() => setNewTransactionUser(null), 5000);
      }
      return newIds;
    });
    scheduleUserRefresh();
  }, [user, scheduleUserRefresh]);

  const handleTicketMessage = useCallback((message: any) => {
    if (message.type !== "ticket" || !message.data) return;
    const ticket = message.data;
    if (!ticket.id) return;

    setTickets((prev) => {
      const idx = prev.findIndex((t) => t.id === ticket.id);
      const updatedAt = ticket.updatedAt ?? ticket.updated_at ?? new Date().toISOString();
      if (idx === -1) {
        return [{
          id: ticket.id,
          userId: ticket.userId ?? ticket.user_id,
          subject: ticket.subject ?? "Ticket",
          status: ticket.status ?? "open",
          priority: ticket.priority,
          updatedAt
        }, ...prev];
      }
      const updated = [...prev];
      updated[idx] = {
        ...updated[idx],
        subject: ticket.subject ?? updated[idx].subject,
        status: ticket.status ?? updated[idx].status,
        priority: ticket.priority ?? updated[idx].priority,
        updatedAt
      };
      return updated;
    });

    setSelectedTicket((prev) => {
      if (!prev || prev.id !== ticket.id) return prev;
      return {
        ...prev,
        subject: ticket.subject ?? prev.subject,
        status: ticket.status ?? prev.status
      };
    });
    scheduleUserRefresh();
  }, [scheduleUserRefresh]);

  useWebSocket({
    apiBase,
    token: authToken ?? "",
    userId: user?.id,
    supportUserId: user?.id,
    streamType: "transactions",
    onMessage: handleTransactionMessage,
    onConnect: () => scheduleUserRefresh(0),
    enabled: Boolean(authToken && user?.id)
  });

  useWebSocket({
    apiBase,
    token: authToken ?? "",
    userId: user?.id,
    supportUserId: user?.id,
    streamType: "tickets",
    onMessage: handleTicketMessage,
    onConnect: () => scheduleUserRefresh(0),
    enabled: Boolean(authToken && user?.id)
  });

  useEffect(() => {
    if (!user?.id) return;
    loadTickets(user.id);
    loadTransactions(user.id);
    loadCards(user.id);
    const interval = setInterval(() => {
      loadTickets(user.id);
      loadTransactions(user.id);
      loadCards(user.id);
    }, 30000);
    return () => clearInterval(interval);
  }, [user?.id, loadTickets, loadTransactions, loadCards]);

  useEffect(() => {
    if (user?.id || !authToken) return;
    const statusFilter = ticketStatus === "all" ? undefined : ticketStatus;
    loadAllTickets(statusFilter);
    const interval = setInterval(() => {
      loadAllTickets(statusFilter);
    }, 30000);
    return () => clearInterval(interval);
  }, [user?.id, authToken, ticketStatus, loadAllTickets]);

  if (authLoading) {
    return (
      <main className="relative overflow-hidden min-h-screen">
        <div className="grid-overlay" />
        <div className="max-w-6xl mx-auto px-6 py-10 space-y-10 relative z-10 fade-in flex items-center justify-center min-h-screen">
          <div className="text-muted">Loading...</div>
        </div>
      </main>
    );
  }

  return (
    <main className="relative overflow-hidden min-h-screen">
      <div className="grid-overlay" />
      <div className="max-w-6xl mx-auto px-6 py-10 space-y-10 relative z-10 fade-in">
        <header className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between slide-up">
          <div className="space-y-4 flex-1">
            <div className="pill inline-flex items-center gap-2 px-4 py-2 text-sm glow-hover">
              <Zap className="h-4 w-4 text-ink" />
              Finance cockpit for TrackIt app
            </div>
            <div className="space-y-2">
              <h1 className="text-4xl md:text-5xl font-semibold font-display tracking-tight">
                TrackIt control deck
              </h1>
            </div>
            <div className="flex flex-wrap gap-3 text-sm text-muted">
              <span className="pill px-3 py-1">Ticket Support</span>
              <span className="pill px-3 py-1">User Lookup</span>
              <span className="pill px-3 py-1">Tracker</span>
            </div>
          </div>
          {supportUser && (
            <div className="flex items-start">
              <button
                onClick={handleLogout}
                className="pill inline-flex items-center gap-2 px-4 py-2 text-sm hover:bg-black/5 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </button>
            </div>
          )}
        </header>

        <section className="card-surface rounded-3xl p-6 slide-up">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-subtle">User lookup</p>
              <p className="text-lg font-semibold">Search by email</p>
            </div>
            <Users className="h-6 w-6 text-ink" />
          </div>
          <form onSubmit={handleSearch} className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="customer@example.com"
              className="input-field w-full rounded-2xl px-4 py-3 text-sm outline-none"
            />
            <button
              type="submit"
              disabled={loading}
              className="button-primary min-w-[140px] rounded-2xl font-semibold px-4 py-3 text-sm disabled:opacity-60 glow-hover"
            >
              {loading ? "Searching..." : "Find user"}
            </button>
          </form>
          {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
        </section>

        {user && (
          <section
            ref={(el) => {
              userSectionRef.current = el;
              sectionElementRef.current = el;
            }}
            className="card-surface rounded-3xl p-6 slide-up"
          >
            <div className="flex items-center justify-between mb-6">
              <div>
                <p className="text-sm text-subtle">User data</p>
                <p className="text-lg font-semibold">{user.name}</p>
              </div>
            </div>

            <div
              className="flex gap-2 mb-6 border-b border-black/10 overflow-x-auto scrollbar-hide"
              ref={(el) => {
                if (el) {
                  const activeButton = el.querySelector(`[data-tab="${activeTab}"]`) as HTMLElement;
                  if (activeButton) {
                    setTimeout(() => {
                      activeButton.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                    }, 100);
                  }
                }
              }}
            >
              <button
                data-tab="overview"
                onClick={() => {
                  setIsTabTransitioning(true);
                  setTimeout(() => {
                    setActiveTab("overview");
                    setNewTransactionCount(0);
                    setNewTransactionUser(null);
                    setIsTabTransitioning(false);
                  }, 150);
                }}
                className={`px-4 py-2 text-sm font-medium transition-all duration-300 whitespace-nowrap ${activeTab === "overview"
                  ? "text-ink border-b-2 border-black"
                  : "text-subtle hover:text-ink"
                  }`}
              >
                Overview
              </button>
              <button
                data-tab="tickets"
                onClick={() => {
                  setIsTabTransitioning(true);
                  setTimeout(() => {
                    setActiveTab("tickets");
                    setIsTabTransitioning(false);
                  }, 150);
                }}
                className={`px-4 py-2 text-sm font-medium transition-all duration-300 whitespace-nowrap ${activeTab === "tickets"
                  ? "text-ink border-b-2 border-black"
                  : "text-subtle hover:text-ink"
                  }`}
              >
                <span className="flex items-center gap-2">
                  <Ticket className="h-4 w-4" />
                  Tickets
                </span>
              </button>
              <button
                data-tab="groq"
                onClick={() => {
                  setActiveTab("groq");
                  setIsTabTransitioning(false);
                }}
                className={`px-4 py-2 text-sm font-medium transition-all duration-300 whitespace-nowrap ${activeTab === "groq"
                  ? "text-ink border-b-2 border-black"
                  : "text-subtle hover:text-ink"
                  }`}
              >
                <span className="flex items-center gap-2">
                  <Bot className="h-4 w-4" />
                  AI Assistant
                </span>
              </button>
              <button
                data-tab="insights"
                onClick={() => {
                  setIsTabTransitioning(true);
                  setTimeout(() => {
                    setActiveTab("insights");
                    setIsTabTransitioning(false);
                    if (sectionElementRef.current) {
                      setTimeout(() => {
                        sectionElementRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }, 200);
                    }
                  }, 150);
                }}
                className={`px-4 py-2 text-sm font-medium transition-all duration-300 whitespace-nowrap ${activeTab === "insights"
                  ? "text-ink border-b-2 border-black"
                  : "text-subtle hover:text-ink"
                  }`}
              >
                <span className="flex items-center gap-2">
                  <Zap className="h-4 w-4" />
                  Insights
                </span>
              </button>
            </div>

            {activeTab === "overview" && (
              <div className={`space-y-4 transition-opacity duration-300 ${isTabTransitioning ? "opacity-0" : "opacity-100"}`}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-2xl surface-muted p-5">
                    <div className="flex items-center justify-between">
                      <p className="text-base text-muted">Cards</p>
                      <Users className="h-5 w-5 text-ink" />
                    </div>
                    <div className="mt-4 space-y-3">
                      {cards.length ? (
                        <>
                          {cards.map((card) => (
                            <div key={card.id} className="flex items-center justify-between">
                              <div>
                                <p className="font-semibold text-ink text-lg">{card.name}</p>
                              </div>
                              <p className="text-base text-ink">€{formatEuro(card.balance ?? 0)}</p>
                            </div>
                          ))}
                          <div className="flex items-center justify-between pt-3 border-t border-black/10">
                            <p className="text-base text-muted">Total balance</p>
                            <p className="font-semibold text-ink text-lg">
                              €{formatEuro(cards.reduce((sum, c) => sum + (c.balance ?? 0), 0))}
                            </p>
                          </div>
                        </>
                      ) : (
                        <p className="text-sm text-subtle">No cards available.</p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl surface-muted p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <p className="text-base text-muted">Recent Transactions</p>
                        {newTransactionCount > 0 && (
                          <span className="px-2 py-0.5 text-xs font-semibold bg-black text-white rounded-full animate-pulse">
                            {newTransactionCount} new{newTransactionUser ? ` (${newTransactionUser})` : ""}
                          </span>
                        )}
                      </div>
                      <ShieldCheck className="h-5 w-5 text-ink" />
                    </div>
                    <div className="mb-4 space-y-2">
                      <input
                        type="text"
                        value={txQuery}
                        onChange={(e) => setTxQuery(e.target.value)}
                        placeholder="Search by name..."
                        className="input-field w-full rounded-xl px-3 py-2 text-sm outline-none"
                      />
                      <div className="flex gap-2 flex-wrap">
                        {(["all", "1d", "3d", "7d", "30d", "90d", "365d"] as const).map((range) => (
                          <button
                            key={range}
                            onClick={() => setTxRange(range)}
                            className={`px-3 py-1 text-xs rounded-lg transition-colors ${txRange === range
                              ? "pill bg-black/10 border-black/30"
                              : "pill bg-black/5 border-black/10 hover:bg-black/10"
                              }`}
                          >
                            {range === "all" ? "All" : range === "1d" ? "1 day" : range === "3d" ? "3 days" : range === "7d" ? "7 days" : range === "30d" ? "30 days" : range === "90d" ? "3 months" : "1 year"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div
                      className="mt-4 space-y-2 max-h-[300px] overflow-y-auto pr-3 scroll-accent"
                      onMouseEnter={() => setNewTransactionCount(0)}
                    >
                      {filterTransactions(transactions, txRange, txQuery).length ? (
                        filterTransactions(transactions, txRange, txQuery).map((tx) => {
                          const categoryColor = tx.categoryColor || (tx.category ? getCategoryColor(tx.category) : null);
                          const isNew = newTransactionIds.has(tx.id);
                          return (
                            <div key={tx.id} className={`group flex items-center justify-between relative rounded-lg border border-black/5 bg-white/70 px-3 py-2.5 transition-all duration-200 hover:bg-white hover:border-black/10 ${isNew ? 'border-black/20 bg-black/[0.03]' : ''}`}>
                              {isNew && (
                                <div key={`indicator-${tx.id}`} className="absolute left-0 top-0 bottom-0 w-1.5 bg-black rounded-l-lg new-transaction-indicator"></div>
                              )}
                              <div className={`flex-1 transition-all duration-300 ${isNew ? 'pl-3' : ''}`}>
                                <p
                                  className="font-semibold text-sm"
                                  style={{ color: categoryColor || "#0b0b0b" }}
                                >
                                  {tx.title}
                                </p>
                                <p className="text-xs text-subtle">
                                  {tx.category ? `${tx.category} • ` : ""}{formatShortDate(tx.date)}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={`font-semibold text-sm ${tx.type === "credit" ? "text-emerald-700" : "text-rose-700"}`}>
                                  {tx.type === "credit" ? "+" : "-"}€{formatEuro(tx.amount)}
                                </span>
                                {isNew && tx.id === newestTransactionId && (
                                  <span className="ml-1 rounded-full border border-black/30 bg-black/10 px-2 py-0.5 text-[10px] font-semibold text-ink transition-opacity duration-200 group-hover:opacity-0">
                                    NEW
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <p className="text-sm text-subtle">No transactions found.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "tickets" && (
              <div className={`transition-opacity duration-300 ${isTabTransitioning ? "opacity-0" : "opacity-100"}`}>
                <div className="flex flex-wrap gap-2 text-sm mb-4">
                  {(["all", "open", "pending", "closed"] as const).map((status) => (
                    <button
                      key={status}
                      onClick={() => setTicketStatus(status)}
                      className={`pill px-3 py-2 capitalize ${ticketStatus === status ? "bg-black/10 border-black/30" : "bg-black/5 border-black/10"
                        }`}
                    >
                      {status}
                    </button>
                  ))}
                </div>

                <div className="space-y-3">
                  {filterTickets(tickets, ticketStatus).length ? (
                    filterTickets(tickets, ticketStatus).map((ticket) => (
                      <div
                        key={ticket.id}
                        onClick={() => {
                          if (ticket.userId && !user) {
                            setUser({ id: ticket.userId, name: "", email: "", lastActive: "" });
                          }
                          setSelectedTicket({ id: ticket.id, subject: ticket.subject, status: ticket.status });
                        }}
                        className={`rounded-2xl bg-white/85 border px-4 py-3 flex items-center justify-between cursor-pointer transition-all duration-200 hover:shadow-lg ${ticketStatus !== "all" && ticket.status === ticketStatus
                            ? ticketStatus === "open"
                              ? "border-emerald-300/70 shadow-lg shadow-emerald-200/40"
                              : ticketStatus === "pending"
                                ? "border-amber-300/70 shadow-lg shadow-amber-200/40"
                                : "border-black/20 shadow-lg shadow-black/10"
                            : "border-black/10 hover:border-black/20"
                          }`}
                      >
                        <div className="flex-1">
                          <p className="font-semibold text-ink">{ticket.subject}</p>
                          <p className="text-xs text-subtle mt-1">
                            Updated {formatRelative(ticket.updatedAt)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`px-3 py-1.5 rounded-2xl text-xs font-medium ${ticket.status === 'open' ? 'badge badge-open' :
                            ticket.status === 'pending' ? 'badge badge-pending' :
                              ticket.status === 'closed' ? 'badge badge-closed' :
                                'badge'
                            }`}>
                            {ticket.status.toUpperCase()}
                          </span>
                          {ticket.priority && (
                            <span className={`px-2.5 py-1 rounded-xl text-xs font-medium ${ticket.priority === 'high' ? 'badge badge-high' :
                              ticket.priority === 'medium' ? 'badge badge-medium' :
                                'badge badge-low'
                              }`}>
                              {ticket.priority}
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-subtle">No tickets found.</div>
                  )}
                </div>
              </div>
            )}

            {activeTab === "groq" && user && (
              <div className={`transition-opacity duration-300 ${isTabTransitioning ? "opacity-0" : "opacity-100"}`}>
                <GroqQuery key={`groq-support-${user.id}`} userId={user.id} apiBase={apiBase} />
              </div>
            )}

            {activeTab === "insights" && user && (
              <div className={`transition-opacity duration-300 ${isTabTransitioning ? "opacity-0" : "opacity-100"}`}>
                <InsightsView transactions={transactions} />
              </div>
            )}
          </section>
        )}

        {!user && (
          <section className="card-surface rounded-3xl p-6 slide-up">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-subtle">Support tickets</p>
                <p className="text-lg font-semibold">User conversations</p>
              </div>
              <Ticket className="h-6 w-6 text-ink" />
            </div>

            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              {(["all", "open", "pending", "closed"] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => {
                    setTicketStatus(status);
                    loadAllTickets(status === "all" ? undefined : status);
                  }}
                  className={`pill px-3 py-2 capitalize ${ticketStatus === status ? "bg-black/10 border-black/30" : "bg-black/5 border-black/10"
                    }`}
                >
                  {status}
                </button>
              ))}
            </div>

            <div className="mt-4 space-y-3">
              {filterTickets(tickets, ticketStatus).length ? (
                filterTickets(tickets, ticketStatus).map((ticket) => (
                  <div
                    key={ticket.id}
                    onClick={() => {
                      if (ticket.userId) {
                        setSelectedTicket({ id: ticket.id, subject: ticket.subject, status: ticket.status });
                      }
                    }}
                    className={`rounded-2xl bg-white/85 border px-4 py-3 flex items-center justify-between cursor-pointer transition-colors ${ticketStatus !== "all" && ticket.status === ticketStatus
                        ? ticketStatus === "open"
                          ? "border-emerald-300/70 bg-emerald-50 hover:bg-emerald-100"
                          : ticketStatus === "pending"
                            ? "border-amber-300/70 bg-amber-50 hover:bg-amber-100"
                            : "border-black/20 bg-black/5 hover:bg-black/10"
                        : "border-black/10 hover:bg-white"
                      }`}
                  >
                    <div>
                      <p className="font-medium">{ticket.subject}</p>
                      <p className="text-xs text-subtle">
                        {ticket.status.toUpperCase()} • Updated {formatRelative(ticket.updatedAt)}
                      </p>
                    </div>
                    <span className="pill px-3 py-1 text-xs capitalize">
                      {ticket.priority ? `${ticket.priority} • ${ticket.status}` : ticket.status}
                    </span>
                  </div>
                ))
              ) : (
                <div className="text-sm text-subtle">No tickets found.</div>
              )}
            </div>
          </section>
        )}

        {selectedTicket && (user || (() => {
          const ticket = tickets.find(t => t.id === selectedTicket.id);
          return ticket?.userId;
        })()) && (
            <TicketChat
              ticketId={selectedTicket.id}
              ticketSubject={selectedTicket.subject}
              ticketStatus={selectedTicket.status}
              userId={user?.id || tickets.find(t => t.id === selectedTicket.id)?.userId || ""}
              authToken={authToken}
              onClose={() => setSelectedTicket(null)}
              apiBase={apiBase}
              onStatusChange={(newStatus) => {
                setTickets(prev => prev.map(t => t.id === selectedTicket.id ? { ...t, status: newStatus } : t));
                setSelectedTicket(prev => prev ? { ...prev, status: newStatus } : null);
              }}
            />
          )}
      </div>
    </main>
  );
}

function filterTickets(tickets: TicketItem[], status: "all" | "open" | "pending" | "closed") {
  if (status === "all") return tickets;
  return tickets.filter((ticket) => ticket.status === status);
}

function formatRelative(value: string) {
  const date = new Date(value);
  if (isNaN(date.getTime())) return "n/a";
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (minutes < 120) return `${minutes} min ago`;
  if (hours < 48) return `${hours} h ago`;
  if (days < 14) return `${days} days ago`;
  return dateLabel.format(date);
}

function formatShortDate(value: string) {
  const date = new Date(value);
  if (isNaN(date.getTime())) return "n/a";
  try {
    return dateLabel.format(date);
  } catch {
    return "n/a";
  }
}

function getCategoryColor(categoryName: string): string {
  if (!categoryName) return "#94a3b8";
  const colors = [
    "#ef4444",
    "#f97316",
    "#eab308",
    "#84cc16",
    "#22c55e",
    "#10b981",
    "#14b8a6",
    "#06b6d4",
    "#0ea5e9",
    "#3b82f6",
    "#6366f1",
    "#8b5cf6",
    "#a855f7",
    "#d946ef",
    "#ec4899",
    "#f43f5e",
    "#f59e0b",
    "#06b6d4",
    "#22c55e",
    "#8b5cf6"
  ];
  let hash = 0;
  for (let i = 0; i < categoryName.length; i++) {
    hash = categoryName.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % colors.length;
  return colors[index];
}

function formatEuro(amount: number) {
  const useConversion = new Date() < euroCutover;
  const value = useConversion ? amount / bgnToEur : amount;
  return Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function filterTransactions(txs: TransactionItem[], range: "all" | "1d" | "3d" | "7d" | "30d" | "90d" | "365d", query: string) {
  const now = new Date();
  const lower = query.trim().toLowerCase();
  return txs.filter((tx: TransactionItem) => {
    const txDate = new Date(tx.date);
    if (!isNaN(txDate.getTime())) {
      const diff = now.getTime() - txDate.getTime();
      if (range === "1d" && diff > 1 * 24 * 60 * 60 * 1000) return false;
      if (range === "3d" && diff > 3 * 24 * 60 * 60 * 1000) return false;
      if (range === "7d" && diff > 7 * 24 * 60 * 60 * 1000) return false;
      if (range === "30d" && diff > 30 * 24 * 60 * 60 * 1000) return false;
      if (range === "90d" && diff > 90 * 24 * 60 * 60 * 1000) return false;
      if (range === "365d" && diff > 365 * 24 * 60 * 60 * 1000) return false;
    }
    if (lower) {
      const haystack = `${tx.title} ${tx.category ?? ""} ${tx.amount}`.toLowerCase();
      if (!haystack.includes(lower)) return false;
    }
    return true;
  });
}

function InsightsView({ transactions }: { transactions: TransactionItem[] }) {
  const [timeframe, setTimeframe] = useState<"7d" | "30d" | "90d" | "365d" | "all">("30d");

  const filtered = filterTransactions(transactions, timeframe, "");

  const income = filtered.filter(tx => tx.type === "credit").reduce((sum, tx) => sum + tx.amount, 0);
  const expenses = filtered.filter(tx => tx.type === "debit").reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
  const net = income - expenses;
  const totalCount = filtered.length;
  const incomeCount = filtered.filter(tx => tx.type === "credit").length;
  const expenseCount = filtered.filter(tx => tx.type === "debit").length;
  const avgTransaction = totalCount > 0 ? (income + expenses) / totalCount : 0;

  const days = timeframe === "7d" ? 7 : timeframe === "30d" ? 30 : timeframe === "90d" ? 90 : timeframe === "365d" ? 365 :
    transactions.length > 0 ? Math.max(1, Math.floor((new Date().getTime() - new Date(transactions[transactions.length - 1].date).getTime()) / (1000 * 60 * 60 * 24))) : 1;
  const transactionsPerDay = days > 0 ? totalCount / days : 0;

  const categoryTotals: Record<string, number> = {};
  filtered.forEach(tx => {
    if (tx.type === "debit" && tx.category) {
      categoryTotals[tx.category] = (categoryTotals[tx.category] || 0) + Math.abs(tx.amount);
    }
  });

  const topCategories = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, amount]) => ({
      name,
      amount,
      percentage: expenses > 0 ? (amount / expenses) * 100 : 0
    }));

  const largestTransactions = [...filtered]
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-ink">Financial Insights</h2>
        <div className="flex gap-2">
          {(["7d", "30d", "90d", "365d", "all"] as const).map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-3 py-1 text-xs rounded-lg transition-colors ${timeframe === tf
                ? "pill bg-black/10 border-black/30"
                : "pill bg-black/5 border-black/10 hover:bg-black/10"
                }`}
            >
              {tf === "7d" ? "Week" : tf === "30d" ? "Month" : tf === "90d" ? "Quarter" : tf === "365d" ? "Year" : "All"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4">
          <p className="text-sm text-subtle">Income</p>
          <p className="text-2xl font-bold text-emerald-700 mt-1">+€{formatEuro(income)}</p>
          <p className="text-xs text-subtle mt-1">{incomeCount} transactions</p>
        </div>
        <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4">
          <p className="text-sm text-subtle">Expenses</p>
          <p className="text-2xl font-bold text-rose-700 mt-1">-€{formatEuro(expenses)}</p>
          <p className="text-xs text-subtle mt-1">{expenseCount} transactions</p>
        </div>
        <div className={`rounded-2xl ${net >= 0 ? 'bg-blue-50 border border-blue-200' : 'bg-amber-50 border border-amber-200'} p-4`}>
          <p className="text-sm text-subtle">Net Balance</p>
          <p className={`text-2xl font-bold mt-1 ${net >= 0 ? 'text-blue-700' : 'text-amber-700'}`}>
            {net >= 0 ? '+' : ''}€{formatEuro(net)}
          </p>
          <p className="text-xs text-subtle mt-1">{totalCount} total</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-2xl surface-muted p-4">
          <h3 className="text-sm font-semibold text-muted mb-3">Statistics</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-subtle">Avg Transaction</span>
              <span className="text-ink">€{formatEuro(avgTransaction)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-subtle">Transactions/Day</span>
              <span className="text-ink">{transactionsPerDay.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-subtle">Period</span>
              <span className="text-ink">{days} days</span>
            </div>
          </div>
        </div>

        <div className="rounded-2xl surface-muted p-4">
          <h3 className="text-sm font-semibold text-muted mb-3">Top Categories</h3>
          <div className="space-y-2 max-h-48 overflow-y-auto scroll-accent">
            {topCategories.length > 0 ? (
              topCategories.map((cat) => (
                <div key={cat.name} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 flex-1">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: getCategoryColor(cat.name) }}
                    />
                    <span className="text-muted">{cat.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-subtle text-xs">{cat.percentage.toFixed(1)}%</span>
                    <span className="text-ink">€{formatEuro(cat.amount)}</span>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-subtle text-sm">No category data</p>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl surface-muted p-4">
        <h3 className="text-sm font-semibold text-muted mb-3">Largest Transactions</h3>
        <div className="space-y-2 max-h-64 overflow-y-auto scroll-accent">
          {largestTransactions.length > 0 ? (
            largestTransactions.map((tx) => {
              const categoryColor = tx.categoryColor || (tx.category ? getCategoryColor(tx.category) : null);
              return (
                <div key={tx.id} className="flex items-center justify-between text-sm py-2 border-b border-black/5 last:border-0">
                  <div className="flex items-center gap-2 flex-1">
                    {categoryColor && (
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: categoryColor }}
                      />
                    )}
                    <span className="text-muted">{tx.title}</span>
                    <span className="text-xs text-subtle">{formatShortDate(tx.date)}</span>
                  </div>
                  <span className={`font-semibold ${tx.type === "credit" ? "text-emerald-700" : "text-rose-700"}`}>
                    {tx.type === "credit" ? "+" : "-"}€{formatEuro(Math.abs(tx.amount))}
                  </span>
                </div>
              );
            })
          ) : (
            <p className="text-subtle text-sm">No transactions</p>
          )}
        </div>
      </div>
    </div>
  );
}

function filterTransactionsModal(txs: TransactionItem[], range: "all" | "1d" | "3d" | "7d" | "30d" | "90d" | "365d", query: string) {
  return filterTransactions(txs, range, query);
}
