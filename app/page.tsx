"use client";

import { ShieldCheck, Ticket, Users, Zap, LogOut, Bot } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import TicketChat from "@/components/TicketChat";
import GroqQuery from "@/components/GroqQuery";

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
const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "https://trackit-dashboard-beryl.vercel.app";
const euroCutover = new Date("2026-01-01T00:00:00Z");
const bgnToEur = 1.95583;

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
  const [isTabTransitioning, setIsTabTransitioning] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const transactionEventSourceRef = useRef<EventSource | null>(null);
  const ticketEventSourceRef = useRef<EventSource | null>(null);
  const userSectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    fetch(`${apiBase}/api/auth/dashboard/session`, {
      credentials: "include",
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated) {
          setSupportUser({ email: data.user.email });
          if (data.token) {
            setAuthToken(data.token);
          }
          loadAllTickets();
        } else {
          router.push("/login");
        }
      })
      .catch(() => {
        router.push("/login");
      })
      .finally(() => {
        setAuthLoading(false);
      });
  }, [router]);

  async function handleLogout() {
    await fetch(`${apiBase}/api/auth/dashboard/logout`, {
      method: "POST",
      credentials: "include",
    });
    document.cookie = "auth-token=; path=/; max-age=0";
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
      const res = await fetch(lookupUrl, { cache: "no-store" });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "User not found");
      }
      const body = await res.json();
      if (!body.user) {
        throw new Error("User not found. Please check the email or ID and try again.");
      }
      setUser(body.user);
      await loadTickets(body.user.id);
      await loadTransactions(body.user.id);
      await loadCards(body.user.id);
      setActiveTab("overview");
      setNewTransactionCount(0);
      startTransactionStream(body.user.id);
      startTicketStream(body.user.id);

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
      stopTransactionStream();
      stopTicketStream();
    } finally {
      setLoading(false);
    }
  }

  function startTransactionStream(userId: string) {
    if (transactionEventSourceRef.current) {
      transactionEventSourceRef.current.close();
    }

    const url = `${apiBase}/api/transactions/stream?userId=${encodeURIComponent(userId)}${authToken ? `&token=${encodeURIComponent(authToken)}` : ""}`;
    const eventSource = new EventSource(url, {
      withCredentials: true,
    });

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "transaction" && data.transaction) {
          const tx = data.transaction;
          setTransactions((prev) => {
            const exists = prev.some((t) => t.id === tx.id);
            if (exists) return prev;
            const mappedTx: TransactionItem = {
              id: tx.id,
              title: tx.category ?? "Transaction",
              amount: typeof tx.amount === "number" ? tx.amount : Number(tx.amount ?? 0),
              date: tx.createdAt ?? tx.created_at ?? tx.date ?? new Date().toISOString(),
              type: (typeof tx.amount === "number" ? tx.amount : Number(tx.amount ?? 0)) >= 0 ? "credit" : "debit",
              category: tx.category ?? undefined,
              categoryColor: tx.categoryColor ?? undefined
            };
            return [mappedTx, ...prev];
          });
          setNewTransactionIds((ids) => {
            if (ids.has(tx.id)) return ids;
            const newIds = new Set([...ids, tx.id]);
            setNewTransactionCount(newIds.size);
            setTimeout(() => {
              setNewTransactionIds((currentIds) => {
                const newSet = new Set(currentIds);
                newSet.delete(tx.id);
                setNewTransactionCount(newSet.size);
                return newSet;
              });
            }, 10000);
            if (user) {
              setNewTransactionUser(user.name || user.email);
              setTimeout(() => setNewTransactionUser(null), 5000);
            }
            return newIds;
          });
        }
      } catch (err) {
      }
    };

    eventSource.onerror = (err) => {
      if (eventSource.readyState === EventSource.CLOSED) {
        eventSource.close();
        setTimeout(() => {
          if (transactionEventSourceRef.current === eventSource && user) {
            startTransactionStream(user.id);
          }
        }, 3000);
      }
    };

    transactionEventSourceRef.current = eventSource;
  }

  function stopTransactionStream() {
    if (transactionEventSourceRef.current) {
      transactionEventSourceRef.current.close();
      transactionEventSourceRef.current = null;
    }
  }

  function startTicketStream(userId: string) {
    if (ticketEventSourceRef.current) {
      ticketEventSourceRef.current.close();
    }

    const url = `${apiBase}/api/tickets/stream?userId=${encodeURIComponent(userId)}${authToken ? `&token=${encodeURIComponent(authToken)}` : ""}`;
    const eventSource = new EventSource(url, {
      withCredentials: true,
    });

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "ticket" && data.ticket) {
          setTickets((prev) => {
            const exists = prev.some((t) => t.id === data.ticket.id);
            if (exists) return prev;
            return [data.ticket, ...prev];
          });
        }
      } catch (err) {
      }
    };

    eventSource.onerror = (err) => {
      if (eventSource.readyState === EventSource.CLOSED) {
        eventSource.close();
        setTimeout(() => {
          if (ticketEventSourceRef.current === eventSource && user) {
            startTicketStream(user.id);
          }
        }, 3000);
      }
    };

    ticketEventSourceRef.current = eventSource;
  }

  function stopTicketStream() {
    if (ticketEventSourceRef.current) {
      ticketEventSourceRef.current.close();
      ticketEventSourceRef.current = null;
    }
  }

  useEffect(() => {
    return () => {
      stopTransactionStream();
      stopTicketStream();
    };
  }, []);

  async function loadAllTickets(status?: string) {
    try {
      const base = apiBase;
      const url = `${base}/api/tickets${status ? `?status=${status}` : ""}`;
      const res = await fetch(url, {
        cache: "no-store",
        credentials: "include",
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
  }

  async function loadTickets(userId: string) {
    try {
      const base = apiBase;
      const url = `${base}/api/tickets?userId=${encodeURIComponent(userId)}`;
      const res = await fetch(url, {
        cache: "no-store",
        credentials: "include",
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
  }

  async function loadTransactions(userId: string) {
    try {
      const base = apiBase;
      const url = `${base}/api/transactions?userId=${encodeURIComponent(userId)}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("Transactions request failed");
      const body = await res.json();
      const mapped: TransactionItem[] = (body.transactions ?? []).map((tx: any) => ({
        id: tx.id,
        title: tx.category ?? "Transaction",
        amount: typeof tx.amount === "number" ? tx.amount : Number(tx.amount ?? 0),
        date: tx.createdAt ?? tx.created_at ?? tx.date ?? new Date().toISOString(),
        type: (typeof tx.amount === "number" ? tx.amount : Number(tx.amount ?? 0)) >= 0 ? "credit" : "debit",
        category: tx.category ?? undefined,
        categoryColor: tx.categoryColor ?? undefined
      }));
      setTransactions(mapped);
    } catch (err) {
      setTransactions([]);
    }
  }

  async function loadCards(userId: string) {
    try {
      const base = apiBase;
      const url = `${base}/api/cards?userId=${encodeURIComponent(userId)}`;
      const res = await fetch(url, { cache: "no-store" });
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
  }

  if (authLoading) {
    return (
      <main className="relative overflow-hidden min-h-screen">
        <div className="grid-overlay" />
        <div className="max-w-6xl mx-auto px-6 py-10 space-y-10 relative z-10 fade-in flex items-center justify-center min-h-screen">
          <div className="text-slate-300">Loading...</div>
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
            <div className="pill inline-flex items-center gap-2 px-4 py-2 text-sm text-slate-200 glow-hover">
              <Zap className="h-4 w-4 text-lime-300" />
              Finance cockpit for TrackIt app
            </div>
            <div className="space-y-2">
              <h1 className="text-4xl md:text-5xl font-semibold font-display tracking-tight">
                TrackIt control deck
              </h1>
            </div>
            <div className="flex flex-wrap gap-3 text-sm text-slate-300">
              <span className="pill px-3 py-1">Ticket Support</span>
              <span className="pill px-3 py-1">User Lookup</span>
              <span className="pill px-3 py-1">Tracker</span>
            </div>
          </div>
          {supportUser && (
            <div className="flex items-start">
              <button
                onClick={handleLogout}
                className="pill inline-flex items-center gap-2 px-4 py-2 text-sm text-slate-200 hover:bg-white/10 transition-colors"
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
              <p className="text-sm text-slate-400">User lookup</p>
              <p className="text-lg font-semibold">Search by email</p>
            </div>
            <Users className="h-6 w-6 text-sky-300" />
          </div>
          <form onSubmit={handleSearch} className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="customer@example.com"
              className="w-full rounded-2xl bg-white/5 border border-white/15 px-4 py-3 text-sm outline-none focus:border-cyan-300/60 focus:bg-white/10"
            />
            <button
              type="submit"
              disabled={loading}
              className="min-w-[140px] rounded-2xl bg-gradient-to-r from-cyan-300 to-sky-400 text-slate-900 font-semibold px-4 py-3 text-sm shadow-lg shadow-cyan-500/30 disabled:opacity-60 glow-hover"
            >
              {loading ? "Searching..." : "Find user"}
            </button>
          </form>
          {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
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
                <p className="text-sm text-slate-400">User data</p>
                <p className="text-lg font-semibold">{user.name}</p>
              </div>
            </div>

            <div
              className="flex gap-2 mb-6 border-b border-white/10 overflow-x-auto scrollbar-hide"
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
                    ? "text-cyan-300 border-b-2 border-cyan-300"
                    : "text-slate-400 hover:text-slate-200"
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
                    ? "text-cyan-300 border-b-2 border-cyan-300"
                    : "text-slate-400 hover:text-slate-200"
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
                  setIsTabTransitioning(true);
                  setTimeout(() => {
                    setActiveTab("groq");
                    setIsTabTransitioning(false);
                  }, 150);
                }}
                className={`px-4 py-2 text-sm font-medium transition-all duration-300 whitespace-nowrap ${activeTab === "groq"
                    ? "text-cyan-300 border-b-2 border-cyan-300"
                    : "text-slate-400 hover:text-slate-200"
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
                    ? "text-cyan-300 border-b-2 border-cyan-300"
                    : "text-slate-400 hover:text-slate-200"
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
                  <div className="rounded-2xl bg-white/5 border border-white/10 p-5">
                    <div className="flex items-center justify-between">
                      <p className="text-base text-slate-200">Cards</p>
                      <Users className="h-5 w-5 text-sky-300" />
                    </div>
                    <div className="mt-4 space-y-3">
                      {cards.length ? (
                        <>
                          {cards.map((card) => (
                            <div key={card.id} className="flex items-center justify-between">
                              <div>
                                <p className="font-semibold text-slate-100 text-lg">{card.name}</p>
                              </div>
                              <p className="text-base text-slate-100">€{formatEuro(card.balance ?? 0)}</p>
                            </div>
                          ))}
                          <div className="flex items-center justify-between pt-3 border-t border-white/10">
                            <p className="text-base text-slate-200">Total balance</p>
                            <p className="font-semibold text-slate-100 text-lg">
                              €{formatEuro(cards.reduce((sum, c) => sum + (c.balance ?? 0), 0))}
                            </p>
                          </div>
                        </>
                      ) : (
                        <p className="text-sm text-slate-400">No cards available.</p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl bg-white/5 border border-white/10 p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <p className="text-base text-slate-200">Recent Transactions</p>
                        {newTransactionCount > 0 && (
                          <span className="px-2 py-0.5 text-xs font-semibold bg-cyan-400 text-slate-900 rounded-full animate-pulse">
                            {newTransactionCount} new{newTransactionUser ? ` (${newTransactionUser})` : ""}
                          </span>
                        )}
                      </div>
                      <ShieldCheck className="h-5 w-5 text-amber-300" />
                    </div>
                    <div className="mb-4 space-y-2">
                      <input
                        type="text"
                        value={txQuery}
                        onChange={(e) => setTxQuery(e.target.value)}
                        placeholder="Search by name..."
                        className="w-full rounded-xl bg-white/5 border border-white/15 px-3 py-2 text-sm outline-none focus:border-cyan-300/60 focus:bg-white/10"
                      />
                      <div className="flex gap-2 flex-wrap">
                        {(["all", "1d", "3d", "7d", "30d", "90d", "365d"] as const).map((range) => (
                          <button
                            key={range}
                            onClick={() => setTxRange(range)}
                            className={`px-3 py-1 text-xs rounded-lg transition-colors ${txRange === range
                                ? "bg-white/10 border border-white/30"
                                : "bg-white/5 border border-white/10 hover:bg-white/8"
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
                            <div key={tx.id} className={`flex items-center justify-between relative rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2.5 transition-all duration-200 hover:bg-white/5 hover:border-white/10 ${isNew ? 'border-cyan-400/30 bg-cyan-400/5' : ''}`}>
                              {isNew && (
                                <div key={`indicator-${tx.id}`} className="absolute left-0 top-0 bottom-0 w-1.5 bg-cyan-400 rounded-l-lg new-transaction-indicator"></div>
                              )}
                              <div className={`flex-1 transition-all duration-300 ${isNew ? 'pl-3' : ''}`}>
                                <p
                                  className="font-semibold text-sm"
                                  style={{ color: categoryColor || "#e2e8f0" }}
                                >
                                  {tx.title}
                                </p>
                                <p className="text-xs text-slate-400">
                                  {tx.category ? `${tx.category} • ` : ""}{formatShortDate(tx.date)}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={`font-semibold text-sm ${tx.type === "credit" ? "text-green-400" : "text-rose-300"}`}>
                                  {tx.type === "credit" ? "+" : "-"}€{formatEuro(tx.amount)}
                                </span>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <p className="text-sm text-slate-400">No transactions found.</p>
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
                      className={`pill px-3 py-2 capitalize ${ticketStatus === status ? "bg-white/10 border-white/30" : "bg-white/5 border-white/10"
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
                        className="rounded-2xl bg-gradient-to-r from-slate-800/60 to-slate-900/60 border border-white/10 px-4 py-3 flex items-center justify-between cursor-pointer hover:from-slate-700/60 hover:to-slate-800/60 hover:border-cyan-400/30 transition-all duration-200 hover:shadow-lg hover:shadow-cyan-500/10"
                      >
                        <div className="flex-1">
                          <p className="font-semibold text-slate-100">{ticket.subject}</p>
                          <p className="text-xs text-slate-400 mt-1">
                            Updated {formatRelative(ticket.updatedAt)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`px-3 py-1.5 rounded-2xl text-xs font-medium ${ticket.status === 'open' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' :
                              ticket.status === 'pending' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
                                ticket.status === 'closed' ? 'bg-slate-500/20 text-slate-400 border border-slate-500/30' :
                                  'bg-slate-500/20 text-slate-400 border border-slate-500/30'
                            }`}>
                            {ticket.status.toUpperCase()}
                          </span>
                          {ticket.priority && (
                            <span className={`px-2.5 py-1 rounded-xl text-xs font-medium ${ticket.priority === 'high' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' :
                                ticket.priority === 'medium' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
                                  'bg-slate-500/20 text-slate-400 border border-slate-500/30'
                              }`}>
                              {ticket.priority}
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-slate-400">No tickets found.</div>
                  )}
                </div>
              </div>
            )}

            {activeTab === "groq" && (
              <div className={`h-[600px] transition-opacity duration-300 ${isTabTransitioning ? "opacity-0" : "opacity-100"}`}>
                <GroqQuery userId={user.id} apiBase={apiBase} />
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
                <p className="text-sm text-slate-400">Support tickets</p>
                <p className="text-lg font-semibold">User conversations</p>
              </div>
              <Ticket className="h-6 w-6 text-lime-300" />
            </div>

            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              {(["all", "open", "pending", "closed"] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => {
                    setTicketStatus(status);
                    loadAllTickets(status === "all" ? undefined : status);
                  }}
                  className={`pill px-3 py-2 capitalize ${ticketStatus === status ? "bg-white/10 border-white/30" : "bg-white/5 border-white/10"
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
                        if (!user) {
                          setUser({ id: ticket.userId, name: "", email: "", lastActive: "" });
                        }
                        setSelectedTicket({ id: ticket.id, subject: ticket.subject });
                      }
                    }}
                    className="rounded-2xl bg-slate/50 border border-white/5 px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors"
                  >
                    <div>
                      <p className="font-medium">{ticket.subject}</p>
                      <p className="text-xs text-slate-400">
                        {ticket.status.toUpperCase()} • Updated {formatRelative(ticket.updatedAt)}
                      </p>
                    </div>
                    <span className="pill px-3 py-1 text-xs capitalize">
                      {ticket.priority ? `${ticket.priority} • ${ticket.status}` : ticket.status}
                    </span>
                  </div>
                ))
              ) : (
                <div className="text-sm text-slate-400">No tickets found.</div>
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
        <h2 className="text-xl font-semibold text-slate-100">Financial Insights</h2>
        <div className="flex gap-2">
          {(["7d", "30d", "90d", "365d", "all"] as const).map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-3 py-1 text-xs rounded-lg transition-colors ${timeframe === tf
                  ? "bg-white/10 border border-white/30"
                  : "bg-white/5 border border-white/10 hover:bg-white/8"
                }`}
            >
              {tf === "7d" ? "Week" : tf === "30d" ? "Month" : tf === "90d" ? "Quarter" : tf === "365d" ? "Year" : "All"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl bg-gradient-to-br from-green-500/10 to-emerald-500/10 border border-green-500/20 p-4">
          <p className="text-sm text-slate-400">Income</p>
          <p className="text-2xl font-bold text-green-400 mt-1">+€{formatEuro(income)}</p>
          <p className="text-xs text-slate-500 mt-1">{incomeCount} transactions</p>
        </div>
        <div className="rounded-2xl bg-gradient-to-br from-rose-500/10 to-red-500/10 border border-rose-500/20 p-4">
          <p className="text-sm text-slate-400">Expenses</p>
          <p className="text-2xl font-bold text-rose-400 mt-1">-€{formatEuro(expenses)}</p>
          <p className="text-xs text-slate-500 mt-1">{expenseCount} transactions</p>
        </div>
        <div className={`rounded-2xl bg-gradient-to-br ${net >= 0 ? 'from-cyan-500/10 to-blue-500/10 border-cyan-500/20' : 'from-amber-500/10 to-orange-500/10 border-amber-500/20'} p-4`}>
          <p className="text-sm text-slate-400">Net Balance</p>
          <p className={`text-2xl font-bold mt-1 ${net >= 0 ? 'text-cyan-400' : 'text-amber-400'}`}>
            {net >= 0 ? '+' : ''}€{formatEuro(net)}
          </p>
          <p className="text-xs text-slate-500 mt-1">{totalCount} total</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-2xl bg-slate-800/50 border border-white/10 p-4">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Statistics</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-400">Avg Transaction</span>
              <span className="text-slate-200">€{formatEuro(avgTransaction)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Transactions/Day</span>
              <span className="text-slate-200">{transactionsPerDay.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Period</span>
              <span className="text-slate-200">{days} days</span>
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-slate-800/50 border border-white/10 p-4">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Top Categories</h3>
          <div className="space-y-2 max-h-48 overflow-y-auto scroll-accent">
            {topCategories.length > 0 ? (
              topCategories.map((cat) => (
                <div key={cat.name} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 flex-1">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: getCategoryColor(cat.name) }}
                    />
                    <span className="text-slate-300">{cat.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-slate-400 text-xs">{cat.percentage.toFixed(1)}%</span>
                    <span className="text-slate-200">€{formatEuro(cat.amount)}</span>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-slate-400 text-sm">No category data</p>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-slate-800/50 border border-white/10 p-4">
        <h3 className="text-sm font-semibold text-slate-300 mb-3">Largest Transactions</h3>
        <div className="space-y-2 max-h-64 overflow-y-auto scroll-accent">
          {largestTransactions.length > 0 ? (
            largestTransactions.map((tx) => {
              const categoryColor = tx.categoryColor || (tx.category ? getCategoryColor(tx.category) : null);
              return (
                <div key={tx.id} className="flex items-center justify-between text-sm py-2 border-b border-white/5 last:border-0">
                  <div className="flex items-center gap-2 flex-1">
                    {categoryColor && (
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: categoryColor }}
                      />
                    )}
                    <span className="text-slate-300">{tx.title}</span>
                    <span className="text-xs text-slate-500">{formatShortDate(tx.date)}</span>
                  </div>
                  <span className={`font-semibold ${tx.type === "credit" ? "text-green-400" : "text-rose-400"}`}>
                    {tx.type === "credit" ? "+" : "-"}€{formatEuro(Math.abs(tx.amount))}
                  </span>
                </div>
              );
            })
          ) : (
            <p className="text-slate-400 text-sm">No transactions</p>
          )}
        </div>
      </div>
    </div>
  );
}

function filterTransactionsModal(txs: TransactionItem[], range: "all" | "1d" | "3d" | "7d" | "30d" | "90d" | "365d", query: string) {
  return filterTransactions(txs, range, query);
}
