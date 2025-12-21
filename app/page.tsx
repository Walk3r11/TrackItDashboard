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
  const [txRange, setTxRange] = useState<"all" | "7d" | "30d">("all");
  const [txQuery, setTxQuery] = useState("");
  const [modalTicketStatus, setModalTicketStatus] = useState<"all" | "open" | "pending" | "closed">("all");
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<{ id: string; subject: string } | null>(null);
  const [supportUser, setSupportUser] = useState<{ email: string } | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "tickets" | "groq">("overview");
  const transactionEventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated) {
          setSupportUser({ email: data.user.email });
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
    await fetch("/api/auth/logout", { method: "POST" });
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
      if (!res.ok) throw new Error("Request failed");
      const body = await res.json();
      if (!body.user) throw new Error("User not found");
      setUser(body.user);
      await loadTickets(body.user.id);
      await loadTransactions(body.user.id);
      await loadCards(body.user.id);
      setActiveTab("overview");
      startTransactionStream(body.user.id);
    } catch (err) {
      setError("Unable to load that user. Verify the query and API endpoint.");
      setUser(null);
      setTickets([]);
      setTransactions([]);
      setCards([]);
      stopTransactionStream();
    } finally {
      setLoading(false);
    }
  }

  function startTransactionStream(userId: string) {
    if (transactionEventSourceRef.current) {
      transactionEventSourceRef.current.close();
    }

    const url = `/api/transactions/stream?userId=${encodeURIComponent(userId)}`;
    const eventSource = new EventSource(url, {
      withCredentials: true,
    });

    eventSource.onopen = () => {
      console.log("Transaction SSE stream opened");
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "transaction" && data.transaction) {
          console.log("New transaction received:", data.transaction);
          setTransactions((prev) => {
            const exists = prev.some((t) => t.id === data.transaction.id);
            if (exists) return prev;
            return [data.transaction, ...prev];
          });
        } else if (data.type === "connected") {
          console.log("SSE connected for transactions");
        } else if (data.type === "error") {
          console.error("SSE error:", data.error);
        }
      } catch (err) {
        console.error("Error parsing SSE transaction:", err);
      }
    };

    eventSource.onerror = (err) => {
      console.error("SSE connection error:", err, eventSource.readyState);
      if (eventSource.readyState === EventSource.CLOSED) {
        eventSource.close();
        setTimeout(() => {
          if (transactionEventSourceRef.current === eventSource && user) {
            console.log("Reconnecting transaction stream...");
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

  useEffect(() => {
    return () => {
      stopTransactionStream();
    };
  }, []);

  async function loadTickets(userId: string) {
    try {
      const base = apiBase;
      const url = `${base}/api/tickets?userId=${encodeURIComponent(userId)}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("Tickets request failed");
      const body = await res.json();
      setTickets(body.tickets ?? []);
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
        date: tx.created_at ?? tx.date ?? new Date().toISOString(),
        type: (typeof tx.amount === "number" ? tx.amount : Number(tx.amount ?? 0)) >= 0 ? "credit" : "debit",
        category: tx.category ?? undefined
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
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="pill inline-flex items-center gap-2 px-4 py-2 text-sm text-slate-200 glow-hover">
                <Zap className="h-4 w-4 text-lime-300" />
                Finance cockpit for TrackIt app
              </div>
              {supportUser && (
                <button
                  onClick={handleLogout}
                  className="pill inline-flex items-center gap-2 px-4 py-2 text-sm text-slate-200 hover:bg-white/10 transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                  Logout
                </button>
              )}
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
        </header>

        <section className="card-surface rounded-3xl p-6 slide-up">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-slate-400">User lookup</p>
              <p className="text-lg font-semibold">Search by email or ID</p>
            </div>
            <Users className="h-6 w-6 text-sky-300" />
          </div>
          <form onSubmit={handleSearch} className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="user@swiftbank.app or UUID"
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
          {!user && !error && <p className="mt-3 text-sm text-slate-400">Start with a user search to load profile and tickets.</p>}
        </section>

        {user && (
          <section className="card-surface rounded-3xl p-6 slide-up">
            <div className="flex items-center justify-between mb-6">
              <div>
                <p className="text-sm text-slate-400">User data</p>
                <p className="text-lg font-semibold">{user.name}</p>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 mb-6 border-b border-white/10">
              <button
                onClick={() => setActiveTab("overview")}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === "overview"
                    ? "text-cyan-300 border-b-2 border-cyan-300"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Overview
              </button>
              <button
                onClick={() => setActiveTab("tickets")}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === "tickets"
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
                onClick={() => setActiveTab("groq")}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === "groq"
                    ? "text-cyan-300 border-b-2 border-cyan-300"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <span className="flex items-center gap-2">
                  <Bot className="h-4 w-4" />
                  Groq Query
                </span>
              </button>
            </div>

            {/* Tab Content */}
            {activeTab === "overview" && (
              <div className="space-y-4">
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
                    <div className="flex items-center justify-between">
                      <p className="text-base text-slate-200">Recent Transactions</p>
                      <ShieldCheck className="h-5 w-5 text-amber-300" />
                    </div>
                    <div className="mt-4 space-y-3 max-h-[300px] overflow-y-auto pr-3 scroll-accent">
                      {transactions.slice(0, 10).length ? (
                        transactions.slice(0, 10).map((tx) => (
                          <div key={tx.id} className="flex items-center justify-between">
                            <div>
                              <p className="font-semibold text-slate-100 text-sm">{tx.title}</p>
                              <p className="text-xs text-slate-400">
                                {tx.category ? `${tx.category} • ` : ""}{formatShortDate(tx.date)}
                              </p>
                            </div>
                            <span className={`font-semibold text-sm ${tx.type === "credit" ? "text-lime-300" : "text-rose-300"}`}>
                              {tx.type === "credit" ? "+" : "-"}€{formatEuro(tx.amount)}
                            </span>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-slate-400">No recent transactions.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "tickets" && (
              <div>
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
                        onClick={() => setSelectedTicket({ id: ticket.id, subject: ticket.subject })}
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
              </div>
            )}

            {activeTab === "groq" && (
              <div className="h-[600px]">
                <GroqQuery userId={user.id} apiBase={apiBase} />
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
                  onClick={() => setTicketStatus(status)}
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
                    onClick={() => user && setSelectedTicket({ id: ticket.id, subject: ticket.subject })}
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

        {/* Ticket Chat Modal */}
        {selectedTicket && user && (
          <TicketChat
            ticketId={selectedTicket.id}
            ticketSubject={selectedTicket.subject}
            userId={user.id}
            onClose={() => setSelectedTicket(null)}
            apiBase={apiBase}
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

function formatEuro(amount: number) {
  const useConversion = new Date() < euroCutover;
  const value = useConversion ? amount / bgnToEur : amount;
  return Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function filterTransactionsModal(txs: TransactionItem[], range: "all" | "7d" | "30d", query: string) {
  const now = new Date();
  const lower = query.trim().toLowerCase();
  return txs.filter((tx) => {
    const txDate = new Date(tx.date);
    if (!isNaN(txDate.getTime())) {
      if (range === "7d" && now.getTime() - txDate.getTime() > 7 * 24 * 60 * 60 * 1000) return false;
      if (range === "30d" && now.getTime() - txDate.getTime() > 30 * 24 * 60 * 60 * 1000) return false;
    }
    if (lower) {
      const haystack = `${tx.title} ${tx.category ?? ""} ${tx.amount}`.toLowerCase();
      if (!haystack.includes(lower)) return false;
    }
    return true;
  });
}
