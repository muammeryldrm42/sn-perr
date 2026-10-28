import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  Bell,
  BookOpen,
  ChevronLeft,
  Copy,
  ExternalLink,
  Radio,
  RefreshCw,
  Search,
  Share2,
  Star,
  Trophy,
} from "lucide-react";
import type { CallTier, Proof, ScanResult, Scored } from "@/lib/gate";
import { paperTrade } from "@/lib/gate";
import { clsxPct, fmtAge, fmtPct, fmtUsd, fmtX, shortMint } from "@/lib/format";
import { dismissNotice, loadBook, loadSeen, loadWatch, mergeBook, noticeDismissed, saveBook, saveSeen, saveWatch, type CallRec } from "@/lib/book";
import { scanMarket, searchMarket } from "@/lib/market-fns";
import { TokenChart } from "@/components/token-chart";

type View = "calls" | "radar" | "record" | "method" | "watch" | "token";
type CallSort = "score" | "h1" | "mcap" | "since" | "new";

const PAGE_VIEWS = new Set<View>(["calls", "radar", "record", "method", "watch"]);

const NAV: { id: Exclude<View, "token">; label: string; icon: typeof Activity }[] = [
  { id: "calls", label: "Calls", icon: Activity },
  { id: "radar", label: "Radar", icon: Radio },
  { id: "record", label: "Record", icon: Trophy },
  { id: "method", label: "Method", icon: BookOpen },
];

const TIERS: { id: "all" | CallTier; label: string }[] = [
  { id: "all", label: "All" },
  { id: "conservative", label: "Conservative" },
  { id: "balanced", label: "Balanced" },
  { id: "risky", label: "Risky" },
];

function dexLabel(dex: string): string {
  const known: Record<string, string> = {
    pumpswap: "PumpSwap",
    pumpfun: "Pump.fun",
    raydium: "Raydium",
    meteora: "Meteora",
    orca: "Orca",
    launchlab: "LaunchLab",
  };
  return known[dex] ?? dex;
}

function pathLabel(path: Proof | null): string {
  if (path === "runner") return "Runner";
  if (path === "graduated") return "Graduated";
  if (path === "boosted") return "Boosted";
  if (path === "fresh") return "Fresh";
  return "Radar";
}

function pathClass(path: Proof | null): string {
  if (path === "fresh") return "text-warn";
  if (path === "runner") return "text-flow";
  if (path === "boosted") return "text-gold";
  return "text-steel";
}

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span className="grid size-8 place-items-center rounded-md bg-flow text-bg" aria-hidden>
        <svg width="16" height="16" viewBox="0 0 16 16">
          <path d="M2.5 13.5 8 2.5l1.6 4.2L13.5 4 11 13.5H2.5Z" fill="currentColor" />
        </svg>
      </span>
      {!compact && <span className="font-mono text-sm font-semibold tracking-widest text-fg">TALONS</span>}
    </span>
  );
}

function TokenMark({ token, size = "size-11" }: { token: { image?: string; symbol: string }; size?: string }) {
  const [bad, setBad] = useState(false);
  const letters = token.symbol.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "?";
  if (!token.image || bad) {
    return (
      <span className={`grid ${size} shrink-0 place-items-center rounded-full bg-row font-mono text-xs font-semibold text-gold`}>
        {letters}
      </span>
    );
  }
  return (
    <img
      src={token.image}
      alt=""
      className={`${size} shrink-0 rounded-full bg-row object-cover`}
      onError={() => setBad(true)}
    />
  );
}

function buyLinks(mint: string, pairUrl: string) {
  const links = [
    { label: "Jupiter", href: `https://jup.ag/swap/SOL-${mint}` },
    { label: "BullX", href: `https://bullx.io/terminal?chainId=1399811149&address=${mint}` },
    { label: "GMGN", href: `https://gmgn.ai/sol/token/${mint}` },
    { label: "Axiom", href: `https://axiom.trade/t/${mint}` },
    { label: "DexScreener", href: pairUrl },
  ];
  if (mint.toLowerCase().endsWith("pump")) links.push({ label: "Pump.fun", href: `https://pump.fun/coin/${mint}` });
  return links;
}

function parseHash(hash: string): { view: View; mint: string | null } {
  const raw = hash.replace(/^#/, "");
  if (raw.startsWith("t/") && raw.length > 2) return { view: "token", mint: decodeURIComponent(raw.slice(2)) };
  if (PAGE_VIEWS.has(raw as View)) return { view: raw as View, mint: null };
  return { view: "calls", mint: null };
}

function writeHash(view: View, mint: string | null) {
  const next = view === "token" && mint ? `#t/${encodeURIComponent(mint)}` : view === "calls" ? "#calls" : `#${view}`;
  if (window.location.hash === next) return;
  window.history.pushState(null, "", next);
}

function shareText(symbol: string, rec?: CallRec): string {
  if (!rec || !(rec.callMcap > 0)) return `${symbol} is on the Talons radar. Memecoins rug. Not financial advice.`;
  const nowX = rec.nowMcap / rec.callMcap;
  const peakX = rec.peakMcap / rec.callMcap;
  return `${symbol} on Talons — called at ${fmtUsd(rec.callMcap)}, now ${fmtX(nowX)}, peak ${fmtX(peakX)}. Memecoins rug. Not financial advice.`;
}

function openShare(symbol: string, rec?: CallRec) {
  const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText(symbol, rec))}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

function multiple(rec?: CallRec): number {
  if (!rec || !(rec.callMcap > 0)) return 0;
  return rec.nowMcap / rec.callMcap;
}

export function TalonsApp({ initial }: { initial: ScanResult }) {
  const [tokens, setTokens] = useState(initial.tokens);
  const [solUsd, setSolUsd] = useState(initial.solUsd);
  const [sources, setSources] = useState(initial.sources);
  const [error, setError] = useState(initial.error);
  const [scannedAt, setScannedAt] = useState(initial.scannedAt);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<View>("calls");
  const [returnTo, setReturnTo] = useState<View>("calls");
  const [mint, setMint] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [extra, setExtra] = useState<Scored[]>([]);
  const [searching, setSearching] = useState(false);
  const [tier, setTier] = useState<(typeof TIERS)[number]["id"]>("all");
  const [sort, setSort] = useState<CallSort>("score");
  const [book, setBook] = useState<CallRec[]>(initial.shared ? initial.book : []);
  const [shared, setShared] = useState(initial.shared);
  const [serverBook, setServerBook] = useState(initial.book);
  const [watch, setWatch] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [showNotice, setShowNotice] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [seenAt, setSeenAt] = useState(0);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [alertRows, setAlertRows] = useState<CallRec[]>([]);
  const seenBoot = useRef(false);
  const lookedUp = useRef(new Set<string>());

  useEffect(() => {
    setWatch(loadWatch());
    setShowNotice(!noticeDismissed());
    setHydrated(true);
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 5000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (shared) {
      setBook(serverBook);
      return;
    }
    setBook((prev) => {
      const base = prev.length ? prev : loadBook();
      const next = mergeBook(tokens, base, Date.now());
      saveBook(next);
      return next;
    });
  }, [tokens, hydrated, shared, serverBook]);

  useEffect(() => {
    if (!hydrated || seenBoot.current) return;
    seenBoot.current = true;
    const stored = loadSeen();
    if (stored > 0) setSeenAt(stored);
    else {
      const stamp = Date.now();
      saveSeen(stamp);
      setSeenAt(stamp);
    }
  }, [hydrated]);

  useEffect(() => {
    const apply = () => {
      const next = parseHash(window.location.hash);
      setView(next.view);
      if (next.mint) setMint(next.mint);
      if (next.view !== "token") setReturnTo(next.view);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (view !== "token" || !mint) return;
    if (tokens.some((token) => token.mint === mint) || extra.some((token) => token.mint === mint) || lookedUp.current.has(mint)) return;
    lookedUp.current.add(mint);
    void searchMarket({ data: { q: mint } })
      .then((rows) => {
        const hit = rows.find((row) => row.mint === mint);
        if (!hit) return;
        setExtra((prev) => (prev.some((row) => row.mint === hit.mint) ? prev : [hit, ...prev]));
      })
      .catch(() => undefined);
  }, [view, mint, tokens, extra]);

  async function refresh() {
    setRefreshing(true);
    try {
      const next = await scanMarket();
      setTokens(next.tokens);
      setSolUsd(next.solUsd);
      setSources(next.sources);
      setError(next.error);
      setScannedAt(next.scannedAt);
      setShared(next.shared);
      setServerBook(next.book);
      if (next.shared) setBook(next.book);
    } catch {
      setError("The scan failed. Retry in a few seconds.");
    } finally {
      setRefreshing(false);
    }
  }

  async function runSearch(q: string) {
    const text = q.trim();
    if (text.length < 2) return;
    setSearching(true);
    try {
      const rows = await searchMarket({ data: { q: text } });
      setExtra(rows);
      if (rows.length === 1) openToken(rows[0].mint);
    } catch {
      setError("Search did not reach DexScreener.");
    } finally {
      setSearching(false);
    }
  }

  function openToken(nextMint: string) {
    setReturnTo(view === "token" ? returnTo : view);
    setMint(nextMint);
    setView("token");
    writeHash("token", nextMint);
  }

  function go(next: Exclude<View, "token">) {
    setView(next);
    setMint(null);
    writeHash(next, null);
  }

  function openAlerts() {
    const fresh = book.filter((row) => row.calledAt > seenAt).sort((a, b) => b.calledAt - a.calledAt);
    setAlertRows(fresh);
    setAlertsOpen((open) => !open);
    if (fresh.length) {
      const stamp = Date.now();
      saveSeen(stamp);
      setSeenAt(stamp);
    }
  }

  function toggleWatch(nextMint: string) {
    setWatch((prev) => {
      const next = prev.includes(nextMint) ? prev.filter((item) => item !== nextMint) : [nextMint, ...prev];
      saveWatch(next);
      return next;
    });
  }

  const bookByMint = useMemo(() => new Map(book.map((row) => [row.mint, row])), [book]);
  const pool = useMemo(() => {
    const map = new Map<string, Scored>();
    for (const token of tokens) map.set(token.mint, token);
    for (const token of extra) if (!map.has(token.mint)) map.set(token.mint, token);
    return [...map.values()];
  }, [tokens, extra]);

  const q = query.trim().toLowerCase();
  const matched = pool.filter(
    (token) =>
      !q ||
      token.symbol.toLowerCase().includes(q) ||
      token.name.toLowerCase().includes(q) ||
      token.mint.toLowerCase().includes(q),
  );
  const calls = matched.filter((token) => token.called && (tier === "all" || token.tier === tier));
  const sortedCalls = [...calls].sort((a, b) => {
    if (sort === "h1") return b.chgH1 - a.chgH1;
    if (sort === "mcap") return b.mcap - a.mcap;
    if (sort === "since") return multiple(bookByMint.get(b.mint)) - multiple(bookByMint.get(a.mint));
    if (sort === "new") return (bookByMint.get(b.mint)?.calledAt ?? 0) - (bookByMint.get(a.mint)?.calledAt ?? 0);
    return b.score - a.score;
  });
  const radar = matched.filter((token) => !token.called).sort((a, b) => b.score - a.score);
  const watched = watch
    .map((item) => pool.find((token) => token.mint === item) ?? null)
    .filter((token): token is Scored => token !== null);
  const selected = mint ? pool.find((token) => token.mint === mint) ?? null : null;
  const selectedRec = mint ? bookByMint.get(mint) : undefined;
  const movers = [...pool].filter((token) => token.chgH1 >= 20).sort((a, b) => b.chgH1 - a.chgH1).slice(0, 14);
  const winners = book
    .map((row) => ({ ...row, peakX: row.callMcap > 0 ? row.peakMcap / row.callMcap : 1 }))
    .filter((row) => row.peakX >= 2)
    .sort((a, b) => b.peakX - a.peakX)
    .slice(0, 8);
  const unseen = book.filter((row) => row.calledAt > seenAt).length;
  const age = now ? fmtAge(now - scannedAt) : "now";
  const feedDown = sources.some((source) => source.id === "pairs" && !source.ok);

  return (
    <div className="min-h-screen bg-bg text-fg">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-panel lg:flex">
        <div className="flex h-16 items-center border-b border-line px-4">
          <button type="button" onClick={() => go("calls")} aria-label="Talons home">
            <Logo />
          </button>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3" aria-label="Main">
          <p className="px-2 pb-1 font-mono text-xs tracking-widest text-dim uppercase">Terminal</p>
          {NAV.map((item) => (
            <NavButton key={item.id} active={view === item.id} onClick={() => go(item.id)} icon={item.icon} label={item.label} />
          ))}
          <NavButton active={view === "watch"} onClick={() => go("watch")} icon={Star} label="Watchlist" count={watch.length || undefined} />
        </nav>
        <div className="border-t border-line p-4">
          <p className="font-mono text-xs tracking-widest text-flow uppercase">Free for everyone</p>
          <p className="mt-2 text-sm text-muted">Same calls, no pack, nothing deleted from this browser's book.</p>
        </div>
      </aside>

      <div className="min-w-0 lg:pl-60">
        <header className="sticky top-0 z-20 border-b border-line bg-bg/95 backdrop-blur">
          <div className="flex items-center gap-2 px-3 py-2 lg:px-5">
            <button type="button" className="lg:hidden" onClick={() => go("calls")} aria-label="Talons home">
              <Logo compact />
            </button>
            <form
              className="min-w-0 flex-1"
              onSubmit={(event) => {
                event.preventDefault();
                void runSearch(query);
              }}
            >
              <label className="flex h-11 items-center gap-2 rounded-lg border border-line bg-panel px-3">
                <Search className="size-4 shrink-0 text-dim" aria-hidden />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Ticker, name, or mint"
                  className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-dim"
                />
              </label>
            </form>
            <button
              type="button"
              onClick={() => go("watch")}
              className="grid size-11 place-items-center rounded-lg border border-line text-muted lg:hidden"
              aria-label="Watchlist"
            >
              <Star className={`size-4 ${view === "watch" ? "fill-gold text-gold" : ""}`} />
            </button>
            <span className="hidden h-11 items-center rounded-lg border border-line px-3 font-mono text-xs text-muted lg:inline-flex">
              SOL {solUsd ? `$${solUsd.toFixed(0)}` : "—"}
            </span>
            <button
              type="button"
              onClick={openAlerts}
              className="relative grid size-11 place-items-center rounded-lg border border-line text-muted"
              aria-label="New calls"
            >
              <Bell className="size-4" />
              {unseen > 0 && (
                <span className="absolute -top-1 -right-1 grid min-w-4 place-items-center rounded-full bg-flow px-1 font-mono text-[10px] text-bg">
                  {unseen > 9 ? "9+" : unseen}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => void refresh()}
              className="inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-panel px-3 text-sm text-muted"
              aria-label="Refresh scan"
            >
              <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
              <span className="hidden md:inline">{refreshing ? "Scanning" : `${age} ago`}</span>
            </button>
          </div>
          {alertsOpen && (
            <div className="absolute inset-x-3 top-16 z-30 max-h-80 overflow-y-auto rounded-lg border border-line bg-panel p-2 shadow-lg lg:inset-x-auto lg:right-5 lg:w-96">
              <p className="px-2 py-1 font-mono text-xs tracking-widest text-dim uppercase">New since you last looked</p>
              {alertRows.length === 0 ? (
                <p className="px-2 py-3 text-sm text-muted">No new calls.</p>
              ) : (
                alertRows.map((row) => (
                  <button
                    key={row.mint}
                    type="button"
                    onClick={() => {
                      setAlertsOpen(false);
                      openToken(row.mint);
                    }}
                    className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left"
                  >
                    <TokenMark token={row} size="size-8" />
                    <span className="min-w-0 flex-1 truncate font-mono text-sm">{row.symbol}</span>
                    <span className="font-mono text-xs text-dim">{fmtUsd(row.callMcap)}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </header>

        <main className="mx-auto flex min-w-0 max-w-6xl flex-col gap-4 px-3 py-4 pb-24 lg:px-5 lg:pb-10">
          {error && (
            <p role="status" className="rounded-lg border border-warn/40 bg-row px-3 py-2 text-sm text-warn">
              {error}
            </p>
          )}
          {feedDown && !error && (
            <p className="rounded-lg border border-line bg-panel px-3 py-2 text-sm text-muted">
              Pair quotes did not come back. Retry the scan.
            </p>
          )}

          {view !== "token" && movers.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Tokens moving this hour">
              {movers.map((token) => (
                <button
                  key={token.mint}
                  type="button"
                  onClick={() => openToken(token.mint)}
                  className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full border border-line bg-panel px-3"
                >
                  <span className="font-mono text-sm">{token.symbol}</span>
                  <span className={`font-mono text-sm ${clsxPct(token.chgH1)}`}>{fmtPct(token.chgH1)}</span>
                </button>
              ))}
            </div>
          )}

          {view === "calls" && (
            <CallsView
              calls={sortedCalls}
              winners={winners}
              radarCount={radar.length}
              bookCount={book.length}
              tier={tier}
              setTier={setTier}
              sort={sort}
              setSort={setSort}
              counts={{
                all: matched.filter((token) => token.called).length,
                conservative: matched.filter((token) => token.tier === "conservative").length,
                balanced: matched.filter((token) => token.tier === "balanced").length,
                risky: matched.filter((token) => token.tier === "risky").length,
              }}
              bookByMint={bookByMint}
              watch={watch}
              now={now}
              showNotice={showNotice}
              shared={shared}
              onDismiss={() => {
                dismissNotice();
                setShowNotice(false);
              }}
              onOpen={openToken}
              onWatch={toggleWatch}
              searching={searching}
              query={query}
              onSearch={() => void runSearch(query)}
            />
          )}
          {view === "radar" && (
            <RadarView tokens={radar.slice(0, 30)} watch={watch} now={now} onOpen={openToken} onWatch={toggleWatch} />
          )}
          {view === "record" && <RecordView book={book} now={now} shared={shared} onOpen={openToken} />}
          {view === "method" && <MethodView sources={sources} />}
          {view === "watch" && (
            <WatchView tokens={watched} missing={watch.length - watched.length} bookByMint={bookByMint} watch={watch} now={now} onOpen={openToken} onWatch={toggleWatch} />
          )}
          {view === "token" && (
            <TokenView
              token={selected}
              rec={selectedRec}
              watched={mint ? watch.includes(mint) : false}
              now={now}
              copied={copied}
              onBack={() => setView(returnTo === "token" ? "calls" : returnTo)}
              onWatch={() => mint && toggleWatch(mint)}
              onCopy={async () => {
                if (!mint) return;
                try {
                  await navigator.clipboard.writeText(mint);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1200);
                } catch {
                  setCopied(false);
                }
              }}
            />
          )}
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-panel lg:hidden" aria-label="Mobile">
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => go(item.id)}
            className={`flex h-16 flex-col items-center justify-center gap-1 text-xs ${view === item.id ? "text-flow" : "text-muted"}`}
          >
            <item.icon className="size-5" />
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function NavButton({
  active,
  onClick,
  icon: Icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Activity;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-11 items-center gap-3 rounded-lg px-3 text-left text-sm ${active ? "bg-row text-fg" : "text-muted"}`}
    >
      <Icon className="size-4" />
      <span className="flex-1">{label}</span>
      {count ? <span className="font-mono text-xs text-dim">{count}</span> : null}
    </button>
  );
}

function CallsView({
  calls,
  winners,
  radarCount,
  bookCount,
  tier,
  setTier,
  sort,
  setSort,
  counts,
  bookByMint,
  watch,
  now,
  showNotice,
  shared,
  onDismiss,
  onOpen,
  onWatch,
  searching,
  query,
  onSearch,
}: {
  calls: Scored[];
  winners: (CallRec & { peakX: number })[];
  radarCount: number;
  bookCount: number;
  tier: (typeof TIERS)[number]["id"];
  setTier: (tier: (typeof TIERS)[number]["id"]) => void;
  sort: CallSort;
  setSort: (sort: CallSort) => void;
  counts: Record<(typeof TIERS)[number]["id"], number>;
  bookByMint: Map<string, CallRec>;
  watch: string[];
  now: number | null;
  showNotice: boolean;
  shared: boolean;
  onDismiss: () => void;
  onOpen: (mint: string) => void;
  onWatch: (mint: string) => void;
  searching: boolean;
  query: string;
  onSearch: () => void;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <p className="font-mono text-xs tracking-widest text-dim uppercase">Solana calls</p>
        <h1 className="text-2xl font-semibold tracking-tight">Only the ones that prove it</h1>
        <p className="mt-1 hidden max-w-2xl text-sm text-muted sm:block">
          Boosts, new pools, and trending Solana pairs. A call needs a run, a live pool, paid attention, or a fresh move — plus health checks.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Live calls" value={String(counts.all)} />
        <Stat label="On radar" value={String(radarCount)} />
        <Stat label="Your book" value={String(bookCount)} />
      </div>
      {showNotice && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-gold/30 bg-panel p-3">
          <p className="text-sm text-muted">
            A call is logged {shared ? "once for every visitor" : "in this browser"} at the market cap Talons first sees it pass the gate. Memecoins rug. This is not financial advice.
          </p>
          <button type="button" onClick={onDismiss} className="h-11 shrink-0 px-2 text-sm text-gold">
            Hide
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {TIERS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTier(item.id)}
            className={`h-11 rounded-full px-3 text-sm ${tier === item.id ? "bg-flow text-bg" : "border border-line bg-panel text-muted"}`}
          >
            {item.label} {counts[item.id]}
          </button>
        ))}
        <span className="mx-1 hidden h-11 w-px bg-line sm:block" />
        {(
          [
            ["score", "Score"],
            ["h1", "1h move"],
            ["mcap", "Mcap"],
            ["since", "Since call"],
            ["new", "Newest"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSort(id)}
            className={`h-11 rounded-full px-3 text-sm ${sort === id ? "bg-row text-fg" : "text-dim"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {winners.length > 0 && (
        <div className="flex gap-2 overflow-x-auto" aria-label="Calls that reached 2x">
          {winners.map((row) => (
            <button
              key={row.mint}
              type="button"
              onClick={() => onOpen(row.mint)}
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full border border-gold/40 bg-panel px-3"
            >
              <span className="font-mono text-sm">{row.symbol}</span>
              <span className="font-mono text-sm text-gold">{fmtX(row.peakX)}</span>
            </button>
          ))}
        </div>
      )}
      {calls.length === 0 ? (
        <Empty
          title="Nothing cleared the gate"
          body={query ? "Try a DexScreener search for that ticker." : "The radar still has names that are close. Health checks are blocking a call."}
          action={query.trim().length >= 2 ? (
            <button type="button" onClick={onSearch} className="h-11 rounded-lg bg-flow px-4 text-sm font-medium text-bg">
              {searching ? "Searching…" : "Search DexScreener"}
            </button>
          ) : null}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {calls.map((token) => (
            <TokenRow
              key={token.mint}
              token={token}
              rec={bookByMint.get(token.mint)}
              watched={watch.includes(token.mint)}
              now={now}
              onOpen={onOpen}
              onWatch={onWatch}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function RadarView({
  tokens,
  watch,
  now,
  onOpen,
  onWatch,
}: {
  tokens: Scored[];
  watch: string[];
  now: number | null;
  onOpen: (mint: string) => void;
  onWatch: (mint: string) => void;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <p className="font-mono text-xs tracking-widest text-dim uppercase">Live radar</p>
        <h1 className="text-2xl font-semibold tracking-tight">Close, not called</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">These are on the scan but still missing a proof or failing a health check.</p>
      </div>
      {tokens.length === 0 ? (
        <Empty title="Radar is clear" body="Every name in this scan already cleared the gate, or the feeds have not answered yet." />
      ) : (
        <div className="flex flex-col gap-2">
          {tokens.map((token) => (
            <TokenRow key={token.mint} token={token} watched={watch.includes(token.mint)} now={now} onOpen={onOpen} onWatch={onWatch} note={token.blockers[0]} />
          ))}
        </div>
      )}
    </section>
  );
}

function WatchView({
  tokens,
  missing,
  bookByMint,
  watch,
  now,
  onOpen,
  onWatch,
}: {
  tokens: Scored[];
  missing: number;
  bookByMint: Map<string, CallRec>;
  watch: string[];
  now: number | null;
  onOpen: (mint: string) => void;
  onWatch: (mint: string) => void;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <p className="font-mono text-xs tracking-widest text-dim uppercase">Watchlist</p>
        <h1 className="text-2xl font-semibold tracking-tight">Starred on this device</h1>
      </div>
      {tokens.length === 0 ? (
        <Empty title="No stars yet" body="Star a call or a radar name. It stays in this browser." />
      ) : (
        <div className="flex flex-col gap-2">
          {tokens.map((token) => (
            <TokenRow key={token.mint} token={token} rec={bookByMint.get(token.mint)} watched={watch.includes(token.mint)} now={now} onOpen={onOpen} onWatch={onWatch} />
          ))}
        </div>
      )}
      {missing > 0 && <p className="text-sm text-dim">{missing} starred mint{missing === 1 ? "" : "s"} not in the latest scan.</p>}
    </section>
  );
}

function RecordView({ book, now, shared, onOpen }: { book: CallRec[]; now: number | null; shared: boolean; onOpen: (mint: string) => void }) {
  const [showTop, setShowTop] = useState(false);
  const rows = book
    .map((row) => {
      const peakX = row.callMcap > 0 ? row.peakMcap / row.callMcap : 1;
      const nowX = row.callMcap > 0 ? row.nowMcap / row.callMcap : 1;
      return { ...row, peakX, nowX, paper: paperTrade(row.callMcap, row.peakMcap, row.nowMcap) };
    })
    .sort((a, b) => b.peakX - a.peakX);
  const hits2 = rows.filter((row) => row.peakX >= 2).length;
  const hits5 = rows.filter((row) => row.peakX >= 5).length;
  const peaks = [...rows.map((row) => row.peakX)].sort((a, b) => a - b);
  const median = peaks.length ? peaks[Math.floor(peaks.length / 2)] : 1;
  const avgPaper = rows.length ? rows.reduce((sum, row) => sum + row.paper.x, 0) / rows.length : 1;
  const best = rows[0];
  const bands = [1.2, 2, 5, 10] as const;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs tracking-widest text-dim uppercase">Track record</p>
          <h1 className="text-2xl font-semibold tracking-tight">{shared ? "One book for every visitor" : "What this browser called"}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            {shared
              ? "Entry is the market cap the first time the gate passed, for everyone. Paper trade sells half at 2x, cuts at 0.6x before that, and trails the rest 35% off the high, net of about 2.5%."
              : "Entry is the market cap at the first pass in this browser. Connect Postgres on Vercel and the book becomes the same for every visitor."}
          </p>
        </div>
        {best && (
          <button
            type="button"
            onClick={() => {
              const text = `Talons, this browser: ${rows.length} calls, ${Math.round((hits2 / rows.length) * 100)}% hit 2x. Best ${best.symbol} ${fmtX(best.peakX)}. Memecoins rug. Not financial advice.`;
              window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
            }}
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg border border-line px-3 text-sm text-muted"
          >
            <Share2 className="size-4" />
            Share
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Calls" value={String(rows.length)} />
        <Stat label="Hit 2x" value={rows.length ? `${Math.round((hits2 / rows.length) * 100)}%` : "—"} />
        <Stat label="Hit 5x" value={rows.length ? `${Math.round((hits5 / rows.length) * 100)}%` : "—"} />
        <Stat label="Median peak" value={rows.length ? fmtX(median) : "—"} />
      </div>
      {rows.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {bands.map((band) => {
            const hits = rows.filter((row) => row.peakX >= band).length;
            return <Stat key={band} label={`${band}x`} value={`${Math.round((hits / rows.length) * 100)}%`} />;
          })}
        </div>
      )}
      {best && <p className="text-sm text-muted">Best call {best.symbol} peaked at {fmtX(best.peakX)}.</p>}
      <p className="text-sm text-muted">Average paper multiple {rows.length ? fmtX(avgPaper) : "—"}.</p>
      {rows.length > 0 && (
        <button
          type="button"
          onClick={() => setShowTop((open) => !open)}
          className="inline-flex h-11 items-center self-start rounded-lg bg-flow px-4 text-sm font-medium text-bg"
        >
          {showTop ? "Hide top X" : "Top X"}
        </button>
      )}
      {showTop && (
        <div className="flex flex-col gap-2">
          <p className="font-mono text-xs tracking-widest text-dim uppercase">Biggest multiples</p>
          {rows.filter((row) => row.peakX > 1).length === 0 ? (
            <Empty title="No multiple yet" body="A call has to run above its entry before it shows here." />
          ) : (
            rows
              .filter((row) => row.peakX > 1)
              .slice(0, 20)
              .map((row, index) => (
                <button
                  key={row.mint}
                  type="button"
                  onClick={() => onOpen(row.mint)}
                  className="flex items-center gap-3 rounded-lg border border-gold/30 bg-panel p-3 text-left"
                >
                  <span className="w-6 font-mono text-sm text-dim">{index + 1}</span>
                  <TokenMark token={row} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono font-semibold">{row.symbol}</span>
                    <span className="block text-xs text-dim">Called at {fmtUsd(row.callMcap)}</span>
                  </span>
                  <span className="font-mono text-xl text-gold">{fmtX(row.peakX)}</span>
                </button>
              ))
          )}
        </div>
      )}
      {rows.length === 0 ? (
        <Empty title="The book is empty" body="Calls land here the moment the gate passes. Leave the terminal open and the peaks update every scan." />
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <button
              key={row.mint}
              type="button"
              onClick={() => onOpen(row.mint)}
              className="flex items-center gap-3 rounded-lg border border-line bg-panel p-3 text-left"
            >
              <TokenMark token={row} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="truncate font-mono font-semibold">{row.symbol}</span>
                  <span className={`font-mono text-xs ${pathClass(row.path)}`}>{pathLabel(row.path)}</span>
                </span>
                <span className="mt-1 block text-xs text-dim">
                  Called {now ? fmtAge(now - row.calledAt) : "…"} ago at {fmtUsd(row.callMcap)}
                </span>
              </span>
              <span className="text-right">
                <span className={`block font-mono ${clsxPct(row.nowX - 1)}`}>{fmtX(row.nowX)}</span>
                <span className="block font-mono text-xs text-gold">peak {fmtX(row.peakX)}</span>
                <span className="block font-mono text-xs text-dim">{row.paper.status} {fmtX(row.paper.x)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function MethodView({ sources }: { sources: ScanResult["sources"] }) {
  return (
    <section className="flex max-w-3xl flex-col gap-4">
      <div>
        <p className="font-mono text-xs tracking-widest text-dim uppercase">How a call is made</p>
        <h1 className="text-2xl font-semibold tracking-tight">Public data, one gate</h1>
        <p className="mt-1 text-sm text-muted">
          This terminal does not invent wallet reads. Bundles, snipers, and KOL buys need a chain worker. Here the proof comes from DexScreener and GeckoTerminal.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {sources.map((source) => (
          <div key={source.id} className="rounded-lg border border-line bg-panel p-3">
            <p className="text-sm">{source.label}</p>
            <p className={`font-mono text-sm ${source.ok ? "text-flow" : "text-warn"}`}>
              {source.ok ? "Live" : "Down"} · {source.count}
            </p>
          </div>
        ))}
      </div>
      <Rule title="Runner" body="Market cap $10K–$12M, up hard on the hour or the 6-hour window, real volume, buys holding, liquidity at least 3% of the cap." />
      <Rule title="Graduated" body="Off the pump.fun curve, under two days old, $25K–$20M, daily volume, and the price still leaning up." />
      <Rule title="Boosted" body="DexScreener boosts or a paid profile, with volume still printing and sells not in control." />
      <Rule title="Fresh" body="Risky tier. Launched in the last 90 minutes, $4K–$180K, already moving, buys at least matching sells." />
      <Rule title="Health veto" body="No call if it is dumping, sells overwhelm buys, liquidity is thin for the size, or the cap is under $5K or over $40M." />
      <Rule
        title="Tiers"
        body="Fresh launches are Risky. Conservative needs thicker liquidity, a calmer hour, a social or boosts, and buys ahead of sells. Everything else that passes is Balanced."
      />
      <Rule
        title="Paper trade"
        body="Buy at the call. Sell half at 2x. If it never hits 2x and falls to 0.6x, cut. After 2x, sell the rest 35% off the high. About 2.5% comes off for costs."
      />
    </section>
  );
}

function Rule({ title, body }: { title: string; body: string }) {
  return (
    <article className="rounded-lg border border-line bg-panel p-4">
      <h2 className="font-medium">{title}</h2>
      <p className="mt-1 text-sm text-muted">{body}</p>
    </article>
  );
}

function TokenView({
  token,
  rec,
  watched,
  now,
  copied,
  onBack,
  onWatch,
  onCopy,
}: {
  token: Scored | null;
  rec?: CallRec;
  watched: boolean;
  now: number | null;
  copied: boolean;
  onBack: () => void;
  onWatch: () => void;
  onCopy: () => void;
}) {
  if (!token && !rec) {
    return <Empty title="Token left the scan" body="It is not in the latest pass. Go back and refresh." />;
  }
  const symbol = token?.symbol ?? rec?.symbol ?? "";
  const name = token?.name ?? rec?.name ?? "";
  const image = token?.image ?? rec?.image;
  const mint = token?.mint ?? rec?.mint ?? "";
  const pairUrl = token?.pairUrl ?? rec?.pairUrl ?? `https://dexscreener.com/solana/${mint}`;
  const since = rec && rec.callMcap > 0 ? rec.nowMcap / rec.callMcap : null;
  const peak = rec && rec.callMcap > 0 ? rec.peakMcap / rec.callMcap : null;

  return (
    <section className="flex flex-col gap-4">
      <button type="button" onClick={onBack} className="inline-flex h-11 items-center gap-1 self-start text-sm text-muted">
        <ChevronLeft className="size-4" /> Back
      </button>
      <div className="flex items-start gap-3">
        <TokenMark token={{ image, symbol }} size="size-14" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-mono text-2xl font-semibold">{symbol}</h1>
          <p className="truncate text-sm text-muted">{name}</p>
          <p className={`font-mono text-xs ${pathClass(token?.path ?? rec?.path ?? null)}`}>
            {pathLabel(token?.path ?? rec?.path ?? null)}
            {token ? ` · ${dexLabel(token.dex)}` : ""}
            {token && now && token.createdAt ? ` · ${fmtAge(now - token.createdAt)} old` : ""}
          </p>
        </div>
        <button type="button" onClick={onWatch} aria-label={watched ? "Unstar" : "Star"} className="grid size-11 place-items-center rounded-lg border border-line">
          <Star className={`size-4 ${watched ? "fill-gold text-gold" : "text-dim"}`} />
        </button>
        <button type="button" onClick={() => openShare(symbol, rec)} aria-label="Share on X" className="grid size-11 place-items-center rounded-lg border border-line text-muted">
          <Share2 className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Market cap" value={fmtUsd(token?.mcap ?? rec?.nowMcap)} />
        <Stat label="1h" value={fmtPct(token?.chgH1 ?? rec?.chgH1)} tone={clsxPct(token?.chgH1 ?? rec?.chgH1 ?? 0)} />
        <Stat label="Since call" value={since ? fmtX(since) : "—"} tone={since ? clsxPct(since - 1) : undefined} />
        <Stat label="Peak" value={peak ? fmtX(peak) : "—"} tone="text-gold" />
      </div>
      {token && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Liquidity" value={fmtUsd(token.liq)} />
          <Stat label="1h volume" value={fmtUsd(token.volH1)} />
          <Stat label="Score" value={String(token.score)} />
          <Stat label="Boosts" value={String(token.boosts)} />
        </div>
      )}
      <div className="rounded-lg border border-line bg-panel p-3">
        <TokenChart
          mint={mint}
          priceUsd={token?.priceUsd ?? 0}
          mcap={token?.mcap ?? rec?.nowMcap ?? 0}
          callMcap={rec?.callMcap}
          calledAt={rec?.calledAt}
        />
      </div>
      {token && token.reasons.length > 0 && (
        <div className="rounded-lg border border-line bg-panel p-4">
          <h2 className="font-medium">Why it is here</h2>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-muted">
            {token.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
      {token && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {token.checks.map((check) => (
            <li key={check.label} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-panel px-3 py-3 text-sm">
              <span>{check.label}</span>
              <span className={`font-mono text-xs ${check.ok ? "text-flow" : "text-warn"}`}>{check.ok ? "Pass" : "Fail"}</span>
            </li>
          ))}
        </ul>
      )}
      {!token?.called && token && token.blockers.length > 0 && (
        <p className="text-sm text-warn">{token.blockers.join(" · ")}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {buyLinks(mint, pairUrl).map((link) => (
          <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-row px-3 text-sm">
            {link.label}
            <ExternalLink className="size-3.5" />
          </a>
        ))}
        {token?.twitter && (
          <a href={token.twitter} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center rounded-lg border border-line px-3 text-sm text-muted">
            X
          </a>
        )}
        {token?.telegram && (
          <a href={token.telegram} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center rounded-lg border border-line px-3 text-sm text-muted">
            Telegram
          </a>
        )}
        {token?.website && (
          <a href={token.website} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center rounded-lg border border-line px-3 text-sm text-muted">
            Site
          </a>
        )}
      </div>
      <button type="button" onClick={() => void onCopy()} className="inline-flex h-11 items-center gap-2 self-start font-mono text-xs text-dim">
        <Copy className="size-3.5" />
        {copied ? "Copied" : shortMint(mint)}
      </button>
      {token?.description && <p className="max-w-2xl text-sm text-muted">{token.description}</p>}
    </section>
  );
}

function TokenRow({
  token,
  rec,
  watched,
  now,
  onOpen,
  onWatch,
  note,
}: {
  token: Scored;
  rec?: CallRec;
  watched: boolean;
  now: number | null;
  onOpen: (mint: string) => void;
  onWatch: (mint: string) => void;
  note?: string;
}) {
  const since = rec && rec.callMcap > 0 ? rec.nowMcap / rec.callMcap : null;
  return (
    <div className="flex items-stretch gap-1 rounded-lg border border-line bg-panel p-2">
      <button type="button" onClick={() => onOpen(token.mint)} className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-1 py-1 text-left">
        <TokenMark token={token} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate font-mono font-semibold">{token.symbol}</span>
            <span className="truncate text-sm text-muted">{token.name}</span>
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-dim">
            <span className={`font-mono ${pathClass(token.path)}`}>{pathLabel(token.path)}</span>
            <span>{dexLabel(token.dex)}</span>
            {now && token.createdAt ? <span>{fmtAge(now - token.createdAt)}</span> : null}
            <span>{fmtUsd(token.mcap)}</span>
            {note ? <span className="text-warn">{note}</span> : null}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className={`block font-mono text-sm ${clsxPct(token.chgH1)}`}>{fmtPct(token.chgH1)}</span>
          <span className="block font-mono text-xs text-dim">
            {since && Math.abs(since - 1) >= 0.05 ? fmtX(since) : `score ${token.score}`}
          </span>
        </span>
      </button>
      <button type="button" onClick={() => onWatch(token.mint)} aria-label={watched ? `Unstar ${token.symbol}` : `Star ${token.symbol}`} className="grid w-11 shrink-0 place-items-center">
        <Star className={`size-4 ${watched ? "fill-gold text-gold" : "text-dim"}`} />
      </button>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel px-3 py-3">
      <p className="font-mono text-xs tracking-widest text-dim uppercase">{label}</p>
      <p className={`mt-1 font-mono text-lg ${tone ?? "text-fg"}`}>{value}</p>
    </div>
  );
}

function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-panel px-4 py-8 text-center">
      <p className="font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">{body}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
