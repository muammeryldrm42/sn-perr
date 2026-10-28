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
import { dismissNotice, loadBook, loadSeen, loadWatch, mergeBook, noticeDismissed, sanePeak, saveBook, saveSeen, saveWatch, type CallRec } from "@/lib/book";
import { scanMarket, searchMarket, loadRisk } from "@/lib/market-fns";
import type { RiskRead } from "@/lib/risk";
import { TokenChart } from "@/components/token-chart";

type View = "calls" | "radar" | "live" | "trending" | "traders" | "record" | "method" | "lab" | "watch" | "token";
type CallSort = "score" | "h1" | "mcap" | "since" | "new";

const PAGE_VIEWS = new Set<View>(["calls", "radar", "live", "trending", "traders", "record", "method", "lab", "watch"]);

const NAV: { id: Exclude<View, "token">; label: string; icon: typeof Activity }[] = [
  { id: "calls", label: "Calls", icon: Activity },
  { id: "live", label: "Live", icon: Radio },
  { id: "trending", label: "Trending", icon: Trophy },
  { id: "radar", label: "Radar", icon: Radio },
  { id: "traders", label: "Traders", icon: Activity },
  { id: "record", label: "Record", icon: Trophy },
  { id: "method", label: "Method", icon: BookOpen },
];

const TIERS: { id: "all" | CallTier; label: string }[] = [
  { id: "all", label: "All" },
  { id: "conservative", label: "Conservative" },
  { id: "balanced", label: "Balanced" },
  { id: "risky", label: "Risky" },
  { id: "ultra", label: "Ultra" },
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
  if (path === "fresh") return "Risky";
  if (path === "ultra") return "Ultra";
  if (path === "reclaim") return "Reclaim";
  return "Radar";
}

function pathClass(path: Proof | null): string {
  if (path === "fresh" || path === "ultra") return "text-warn";
  if (path === "runner") return "text-flow";
  if (path === "boosted") return "text-gold";
  if (path === "reclaim") return "text-gold";
  return "text-steel";
}

function bookToken(rec: CallRec): Scored {
  return {
    mint: rec.mint,
    name: rec.name,
    symbol: rec.symbol,
    image: rec.image,
    dex: rec.dex,
    pairUrl: rec.pairUrl,
    mcap: rec.nowMcap,
    fdv: rec.nowMcap,
    liq: rec.liq,
    priceUsd: 0,
    volM5: 0,
    volH1: 0,
    volH24: 0,
    chgM5: 0,
    chgH1: rec.chgH1,
    chgH6: 0,
    chgH24: 0,
    buysM5: 0,
    sellsM5: 0,
    buysH1: 0,
    sellsH1: 0,
    createdAt: rec.calledAt,
    boosts: rec.boosts,
    dexPaid: false,
    twitter: rec.twitter,
    website: rec.website,
    telegram: rec.telegram,
    score: rec.score,
    called: true,
    path: rec.path,
    tier: rec.path === "fresh" ? "risky" : rec.path === "ultra" ? "ultra" : "balanced",
    reasons: rec.reasons,
    blockers: [],
    checks: [],
  };
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
    { label: "Jupiter", href: `https://jup.ag/tokens/${mint}` },
    { label: "BullX", href: `https://bullx.io/terminal?chainId=1399811149&address=${mint}` },
    { label: "GMGN", href: `https://gmgn.ai/sol/token/${mint}` },
    { label: "Axiom", href: `https://axiom.trade/t/${mint}` },
    { label: "DexScreener", href: pairUrl },
  ];
  if (mint.toLowerCase().endsWith("pump")) links.push({ label: "Pump.fun", href: `https://pump.fun/coin/${mint}` });
  return links;
}

function parseHash(hash: string): { view: View; mint: string | null; tier: (typeof TIERS)[number]["id"] | null } {
  const raw = hash.replace(/^#/, "");
  if (raw.startsWith("t/") && raw.length > 2) return { view: "token", mint: decodeURIComponent(raw.slice(2)), tier: null };
  if (raw === "conservative" || raw === "balanced" || raw === "risky" || raw === "ultra") return { view: "calls", mint: null, tier: raw };
  if (raw === "fresh") return { view: "calls", mint: null, tier: "risky" };
  if (raw === "archive") return { view: "record", mint: null, tier: null };
  if (PAGE_VIEWS.has(raw as View)) return { view: raw as View, mint: null, tier: raw === "calls" ? "balanced" : null };
  return { view: "calls", mint: null, tier: "balanced" };
}

function writeHash(view: View, mint: string | null) {
  const next = view === "token" && mint ? `#t/${encodeURIComponent(mint)}` : view === "calls" ? "#calls" : `#${view}`;
  if (window.location.hash === next) return;
  window.history.pushState(null, "", next);
}

function shareText(symbol: string, rec?: CallRec): string {
  if (!rec || !(rec.callMcap > 0)) return `${symbol} is on the Talons radar. Memecoins rug. Not financial advice.`;
  const nowX = rec.nowMcap / rec.callMcap;
  const peakX = sanePeak(rec.callMcap, rec.nowMcap, rec.peakMcap, 0, rec.liq) / rec.callMcap;
  return `${symbol} on Talons. Called at ${fmtUsd(rec.callMcap)}, now ${fmtX(nowX)}, peak ${fmtX(peakX)}. Memecoins rug. Not financial advice.`;
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
  const tokensRef = useRef(initial.tokens);
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
      const next = mergeBook([...tokens, ...extra], base, Date.now());
      saveBook(next);
      return next;
    });
  }, [tokens, extra, hydrated, shared, serverBook]);

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
      if (next.tier) setTier(next.tier);
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
    }, 12_000);
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

  useEffect(() => {
    if (view !== "token" || !mint) return;
    const pull = () => {
      void searchMarket({ data: { q: mint } })
        .then((rows) => {
          const hit = rows.find((row) => row.mint === mint);
          if (!hit) return;
          setExtra((prev) => [hit, ...prev.filter((row) => row.mint !== hit.mint)]);
        })
        .catch(() => undefined);
    };
    const id = window.setInterval(pull, 12_000);
    return () => window.clearInterval(id);
  }, [view, mint]);

  async function refresh() {
    setRefreshing(true);
    try {
      const next = await scanMarket();
      setSolUsd(next.solUsd);
      setSources(next.sources);
      setScannedAt(next.scannedAt);
      setShared(next.shared);
      setServerBook(next.book);
      if (next.shared) setBook(next.book);
      if (next.tokens.length) {
        setTokens(next.tokens);
        setError(null);
      } else if (!tokensRef.current.length) {
        setError(next.error);
      } else {
        setError(null);
      }
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
    setAlertsOpen((open) => !open);
    if (book.some((row) => row.calledAt > seenAt)) {
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

  tokensRef.current = tokens;

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
  const board = new Map<string, Scored>();
  const cooling = new Set<string>();
  for (const token of matched) {
    if (token.called) board.set(token.mint, token);
  }
  if (now) {
    for (const rec of book) {
      if (board.has(rec.mint) || now - rec.calledAt > 8 * 60 * 60 * 1000) continue;
      const live = pool.find((token) => token.mint === rec.mint);
      if (live && live.createdAt > 0 && now - live.createdAt > 24 * 60 * 60 * 1000) continue;
      const row = live ?? bookToken(rec);
      if (q && !`${row.symbol} ${row.name} ${row.mint}`.toLowerCase().includes(q)) continue;
      board.set(rec.mint, { ...row, called: true, path: rec.path, tier: row.tier ?? (rec.path === "fresh" ? "risky" : "balanced") });
      cooling.add(rec.mint);
    }
  }
  const calls = [...board.values()].filter((token) => tier === "all" || token.tier === tier);
  const sortedCalls = [...calls].sort((a, b) => {
    if (sort === "h1") return b.chgH1 - a.chgH1;
    if (sort === "mcap") return b.mcap - a.mcap;
    if (sort === "since") return multiple(bookByMint.get(b.mint)) - multiple(bookByMint.get(a.mint));
    if (sort === "new") return (bookByMint.get(b.mint)?.calledAt ?? b.createdAt) - (bookByMint.get(a.mint)?.calledAt ?? a.createdAt);
    const cool = Number(cooling.has(a.mint)) - Number(cooling.has(b.mint));
    return cool || b.score - a.score;
  });
  const radar = matched.filter((token) => !token.called && !board.has(token.mint)).sort((a, b) => b.score - a.score);
  const watched = watch
    .map((item) => pool.find((token) => token.mint === item) ?? null)
    .filter((token): token is Scored => token !== null);
  const selected = mint ? pool.find((token) => token.mint === mint) ?? null : null;
  const selectedRec = mint ? bookByMint.get(mint) : undefined;
  const movers = [...pool].filter((token) => token.chgH1 >= 20).sort((a, b) => b.chgH1 - a.chgH1).slice(0, 14);
  const winners = book
    .map((row) => ({ ...row, peakX: row.callMcap > 0 ? sanePeak(row.callMcap, row.nowMcap, row.peakMcap, 0, row.liq) / row.callMcap : 1 }))
    .filter((row) => row.peakX >= 2)
    .sort((a, b) => b.peakX - a.peakX)
    .slice(0, 8);
  const unseen = book.filter((row) => row.calledAt > seenAt).length;
  const latestAlerts = [...book].sort((a, b) => b.calledAt - a.calledAt).slice(0, 9);
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
          <p className="mt-2 text-sm text-muted">
            {shared ? "One call book for every visitor. Stars stay on this browser." : "Calls are saved in this browser until Postgres is connected."}
          </p>
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
              <p className="px-2 py-1 font-mono text-xs tracking-widest text-dim uppercase">Last 9 calls</p>
              {latestAlerts.length === 0 ? (
                <p className="px-2 py-3 text-sm text-muted">No calls yet.</p>
              ) : (
                latestAlerts.map((row) => (
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
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-sm">{row.symbol}</span>
                      <span className="block truncate text-xs text-dim">
                        {pathLabel(row.path)}
                        {now ? ` · ${fmtAge(now - row.calledAt)}` : ""}
                        {` · ${fmtUsd(row.callMcap)}`}
                      </span>
                    </span>
                    <span className={`font-mono text-xs ${row.callMcap > 0 ? clsxPct(row.nowMcap / row.callMcap - 1) : "text-dim"}`}>
                      {row.callMcap > 0 ? fmtX(row.nowMcap / row.callMcap) : fmtUsd(row.nowMcap)}
                    </span>
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
              cooling={cooling}
              winners={winners}
              radarCount={radar.length}
              bookCount={book.length}
              tier={tier}
              setTier={setTier}
              sort={sort}
              setSort={setSort}
              counts={{
                all: board.size,
                conservative: [...board.values()].filter((token) => token.tier === "conservative").length,
                balanced: [...board.values()].filter((token) => token.tier === "balanced").length,
                risky: [...board.values()].filter((token) => token.tier === "risky").length,
                ultra: [...board.values()].filter((token) => token.tier === "ultra").length,
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
          {view === "live" && (
            <FeedView
              kicker="Just launched"
              title="Still in the first minutes"
              body="Newest names from Pump.fun, Bonk, Meteora, and Raydium. A name here is not a call."
              empty="No launch under 20 minutes in this scan."
              tokens={[...pool].filter((token) => token.createdAt > 0 && now && now - token.createdAt < 20 * 60_000).sort((a, b) => b.createdAt - a.createdAt).slice(0, 30)}
              watch={watch}
              now={now}
              onOpen={openToken}
              onWatch={toggleWatch}
            />
          )}
          {view === "trending" && (
            <FeedView
              kicker="Trending"
              title="Where the volume is"
              body="Highest one-hour volume in this scan. Volume is not a call."
              empty="The scan has no volume yet."
              tokens={[...pool].sort((a, b) => b.volH1 - a.volH1).slice(0, 30)}
              watch={watch}
              now={now}
              onOpen={openToken}
              onWatch={toggleWatch}
            />
          )}
          {view === "traders" && <TradersView />}
          {view === "record" && <RecordView book={book} shared={shared} onOpen={openToken} />}
          {view === "method" && <MethodView sources={sources} onLab={() => go("lab")} />}
          {view === "lab" && <LabView book={book} />}
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

      <nav className="fixed inset-x-0 bottom-0 z-30 flex overflow-x-auto border-t border-line bg-panel lg:hidden" aria-label="Mobile">
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => go(item.id)}
            className={`flex h-16 w-20 shrink-0 flex-col items-center justify-center gap-1 text-xs ${view === item.id ? "text-flow" : "text-muted"}`}
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
  cooling,
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
  cooling: Set<string>;
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
          New launches, runners, graduations, confirmed boosts, and dip reclaims. A call needs a live bid. Dead coins stay off the board.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Live calls" value={String(counts.all)} />
        <Stat label="On radar" value={String(radarCount)} />
        <Stat label={shared ? "Shared book" : "This browser"} value={String(bookCount)} />
      </div>
      {showNotice && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-gold/30 bg-panel p-3">
          <p className="text-sm text-muted">
            {shared
              ? "A call is logged once for every visitor, at the market cap Talons first sees it pass the gate."
              : "Calls on this deploy stay in this browser. In Vercel, Neon must set DATABASE_URL or POSTGRES_URL, then redeploy, or the public site will not share one book."}{" "}
            Memecoins rug. This is not financial advice.
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
              note={cooling.has(token.mint) ? "Cooling" : undefined}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function FeedView({
  kicker,
  title,
  body,
  empty,
  tokens,
  watch,
  now,
  onOpen,
  onWatch,
}: {
  kicker: string;
  title: string;
  body: string;
  empty: string;
  tokens: Scored[];
  watch: string[];
  now: number | null;
  onOpen: (mint: string) => void;
  onWatch: (mint: string) => void;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <p className="font-mono text-xs tracking-widest text-dim uppercase">{kicker}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">{body}</p>
      </div>
      {tokens.length === 0 ? (
        <Empty title="Nothing in this pass" body={empty} />
      ) : (
        <div className="flex flex-col gap-2">
          {tokens.map((token) => (
            <TokenRow key={token.mint} token={token} watched={watch.includes(token.mint)} now={now} onOpen={onOpen} onWatch={onWatch} />
          ))}
        </div>
      )}
    </section>
  );
}

function TradersView() {
  return (
    <section className="flex max-w-3xl flex-col gap-4">
      <div>
        <p className="font-mono text-xs tracking-widest text-dim uppercase">Wallets</p>
        <h1 className="text-2xl font-semibold tracking-tight">KOL and smart money</h1>
        <p className="mt-1 text-sm text-muted">
          A public wallet list did not return rows without an API key. Buys are not counted, and nothing here is invented. Kolscan is free to read in the browser.
        </p>
      </div>
      <a href="https://kolscan.io" target="_blank" rel="noreferrer" className="h-11 self-start rounded-lg border border-line px-3 text-sm leading-[2.75rem] text-muted">
        Open Kolscan
      </a>
    </section>
  );
}

function RiskLine({ mint }: { mint: string }) {
  const [risk, setRisk] = useState<RiskRead | null>(null);
  useEffect(() => {
    let dead = false;
    void loadRisk({ data: { mint } })
      .then((row) => {
        if (!dead) setRisk(row);
      })
      .catch(() => {
        if (!dead) setRisk(null);
      });
    return () => {
      dead = true;
    };
  }, [mint]);
  const label = !risk ? "RugCheck" : risk.state === "clean" ? "Clean" : risk.state === "rug" ? "Rug likely" : risk.state === "warn" ? "Warning" : "Checking";
  const tone = risk?.state === "clean" ? "text-flow" : risk?.state === "rug" ? "text-warn" : "text-gold";
  return (
    <p className={`font-mono text-xs ${tone}`}>
      {label}
      {risk?.gem ? " · Gem" : ""}
      {risk?.lpLockedPct != null ? ` · LP lock ${Math.round(risk.lpLockedPct)}%` : ""}
      {risk?.risks[0] ? ` · ${risk.risks[0]}` : ""}
    </p>
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

function RecordView({ book, shared, onOpen }: { book: CallRec[]; shared: boolean; onOpen: (mint: string) => void }) {
  const [page, setPage] = useState(0);
  const rows = book
    .map((row) => {
      const peakMcap = sanePeak(row.callMcap, row.nowMcap, row.peakMcap, 0, row.liq);
      const peakX = row.callMcap > 0 ? peakMcap / row.callMcap : 1;
      const nowX = row.callMcap > 0 ? row.nowMcap / row.callMcap : 1;
      return { ...row, peakX, nowX, paper: paperTrade(row.callMcap, peakMcap, row.nowMcap) };
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
            Losers stay in this list. Entry is the market cap at the first pass. Paper trade sells half at 2x, cuts at 0.6x before that, and trails the rest 35% off the high, net of 2.5%.
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
        <button
          type="button"
          onClick={() => {
            const header = "symbol,mint,called_at,call_mcap,now_mcap,peak_mcap,path,now_x,peak_x";
            const lines = rows.map((row) =>
              [row.symbol, row.mint, row.calledAt, row.callMcap, row.nowMcap, sanePeak(row.callMcap, row.nowMcap, row.peakMcap, 0, row.liq), row.path, row.nowX.toFixed(4), row.peakX.toFixed(4)].join(","),
            );
            const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = "talons-calls.csv";
            link.click();
            URL.revokeObjectURL(url);
          }}
          className="inline-flex h-11 shrink-0 items-center rounded-lg border border-line px-3 text-sm text-muted"
        >
          Export
        </button>
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
      {rows.length === 0 ? (
        <Empty title="The book is empty" body="Calls land here the moment the gate passes. The biggest multiples stay on this page." />
      ) : (
        <div className="flex flex-col gap-2">
          <p className="font-mono text-xs tracking-widest text-dim uppercase">Top X</p>
          {rows.slice(page * 25, page * 25 + 25).map((row, index) => (
            <button
              key={row.mint}
              type="button"
              onClick={() => onOpen(row.mint)}
              className="flex items-center gap-3 rounded-lg border border-line bg-panel p-3 text-left"
            >
              <span className="w-6 font-mono text-sm text-dim">{page * 25 + index + 1}</span>
              <TokenMark token={row} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono font-semibold">{row.symbol}</span>
                <span className="block text-xs text-dim">Called at {fmtUsd(row.callMcap)} · now {fmtX(row.nowX)}</span>
              </span>
              <span className="font-mono text-xl text-gold">{fmtX(row.peakX)}</span>
            </button>
          ))}
          {rows.length > 25 && (
            <button
              type="button"
              onClick={() => setPage((current) => (current + 1) % Math.ceil(rows.length / 25))}
              className="h-9 self-start px-1 text-sm text-muted"
            >
              {page + 1 >= Math.ceil(rows.length / 25) ? "First 25" : "Next 25"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function MethodView({ sources, onLab }: { sources: ScanResult["sources"]; onLab: () => void }) {
  return (
    <section className="flex max-w-3xl flex-col gap-4">
      <div>
        <p className="font-mono text-xs tracking-widest text-dim uppercase">How a call is made</p>
        <h1 className="text-2xl font-semibold tracking-tight">Fewer calls. Nothing hidden.</h1>
        <p className="mt-1 text-sm text-muted">
          A call stays in the book, winners and losers. These are the live numbers. Wallet reads, KOL buys, and RugCheck are not live yet, so they are not pretended.
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
      <Rule title="Ultra" body="First 3 minutes, market cap $6K to $80K, at least 3 buys, buys ahead of sells, liquidity at least $1.5K. Cap: 40 an hour, 120 a day." />
      <Rule title="Risky" body="3 to 45 minutes old, $6K to $40K, buys at least 1.5x the sells. Cap: 15 an hour, 80 a day. #risky and #fresh open this list." />
      <Rule title="Balanced" body="Runner or graduated, under a day old, buys ahead, and traded volume at least 30% of market cap. Shares a cap with conservative: 3 an hour, 50 a day. #calls opens this list." />
      <Rule title="Conservative" body="A balanced call with liquidity at least 8% of market cap, age at least 20 minutes, hour between -5% and +80%, buys at least 1.1x sells. No paid-boost shortcut." />
      <Rule title="Rejected" body="Paid boost with thin volume, a big hourly candle without trades, a dump, a rollover, or a chase. Those stay off the book." />
      <Rule title="Paper trade" body="Buy at the call. Sell half at 2x. If it never hits 2x and trades at 0.6x, cut. After 2x, sell the rest 35% off the high. 2.5% is taken off for costs. This is an estimate from entry, peak, and the latest price." />
      <Rule title="RugCheck" body="Public summary, no key. A danger flag blocks that call. Clean, LP lock at least 90%, and no listed risk is a Gem. Missing reports stay Checking and do not become a pass." />
      <Rule title="Other pads" body="Bonk, Meteora, Raydium, and LaunchLab pairs under 6 hours are added when the main list is short. Pump.fun is still the early feed." />
      <Rule title="Not live yet" body="PumpPortal stays open only with a long-lived worker. Wallet bundle, snipe, dev history, and KOL buys need a chain key or a public list that actually returns rows. Those are not faked." />
      <Rule title="Changelog" body="2026-10-28: four lanes, hourly caps, 30% volume floor on balanced, losers stay in the book, lab counts only stored calls. A public schedule wakes the scan about every 15 minutes, even when nobody has the site open. It is not a live socket." />
      <button type="button" onClick={onLab} className="h-11 self-start rounded-lg border border-line px-3 text-sm text-muted">
        Open the lab
      </button>
    </section>
  );
}

function band(hits: number, n: number): string {
  if (n < 1) return "n/a";
  const z = 1.96;
  const p = hits / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / denom;
  const lo = Math.max(0, center - margin);
  const hi = Math.min(1, center + margin);
  return `${Math.round(lo * 100)}-${Math.round(hi * 100)}%`;
}

function LabView({ book }: { book: CallRec[] }) {
  const lanes = [
    { id: "core", label: "Balanced and conservative", match: (row: CallRec) => row.path !== "fresh" && row.path !== "ultra" },
    { id: "risky", label: "Risky", match: (row: CallRec) => row.path === "fresh" },
    { id: "ultra", label: "Ultra", match: (row: CallRec) => row.path === "ultra" },
  ] as const;
  return (
    <section className="flex max-w-3xl flex-col gap-4">
      <div>
        <p className="font-mono text-xs tracking-widest text-dim uppercase">Public lab</p>
        <h1 className="text-2xl font-semibold tracking-tight">Measured from the book</h1>
        <p className="mt-1 text-sm text-muted">
          Hit rate is peak over the call, from calls that are actually stored. A small sample is a small sample. Trial rules without chain data are not scored.
        </p>
      </div>
      {book.length === 0 ? (
        <Empty title="Nothing to measure" body="The lab fills when the book has calls. No sample is invented." />
      ) : (
        <div className="grid gap-2">
          {lanes.map((lane) => {
            const rows = book.filter(lane.match);
            const hit2 = rows.filter((row) => row.callMcap > 0 && sanePeak(row.callMcap, row.nowMcap, row.peakMcap, 0, row.liq) / row.callMcap >= 2).length;
            const lost = rows.filter((row) => row.callMcap > 0 && row.nowMcap / row.callMcap <= 0.2).length;
            const paper = rows.length ? rows.reduce((sum, row) => sum + paperTrade(row.callMcap, row.peakMcap, row.nowMcap).x, 0) / rows.length : 0;
            return (
              <article key={lane.id} className="rounded-lg border border-line bg-panel p-4">
                <h2 className="font-medium">{lane.label}</h2>
                <p className="mt-1 font-mono text-sm text-muted">
                  {rows.length} calls
                  {rows.length ? ` · ${Math.round((hit2 / rows.length) * 100)}% hit 2x · ${Math.round((lost / rows.length) * 100)}% at or under 0.2x · paper ${fmtX(paper)}` : " · no calls yet"}
                  {rows.length ? ` · 2x band ${band(hit2, rows.length)}` : ""}
                </p>
                {rows.length > 0 && rows.length < 20 ? <p className="mt-1 text-xs text-dim">Under 20 calls. Do not treat this as a result.</p> : null}
              </article>
            );
          })}
        </div>
      )}
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
  const mint = token?.mint ?? rec?.mint ?? "";
  if (!token && !rec) {
    return <Empty title="Token left the scan" body="It is not in the latest pass. Go back and refresh." />;
  }
  const symbol = token?.symbol ?? rec?.symbol ?? "";
  const name = token?.name ?? rec?.name ?? "";
  const image = token?.image ?? rec?.image;
  const pairUrl = token?.pairUrl ?? rec?.pairUrl ?? `https://dexscreener.com/solana/${mint}`;
  const liveMcap = token && token.mcap > 0 ? token.mcap : (rec?.nowMcap ?? 0);
  const since = rec && rec.callMcap > 0 ? liveMcap / rec.callMcap : null;
  const peak = rec && rec.callMcap > 0 ? sanePeak(rec.callMcap, rec.nowMcap, rec.peakMcap, liveMcap, token?.liq || rec.liq) / rec.callMcap : null;

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
          {mint ? <RiskLine mint={mint} /> : null}
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
        <Stat label="Called at" value={rec ? fmtUsd(rec.callMcap) : "—"} />
        <Stat label="Since call" value={since ? fmtX(since) : "—"} tone={since ? clsxPct(since - 1) : undefined} />
        <Stat label="Peak" value={peak ? fmtX(peak) : "—"} tone="text-gold" />
      </div>
      {token && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="1h" value={fmtPct(token.chgH1)} tone={clsxPct(token.chgH1)} />
          <Stat label="Liquidity" value={fmtUsd(token.liq)} />
          <Stat label="1h volume" value={fmtUsd(token.volH1)} />
          <Stat label="Score" value={String(token.score)} />
        </div>
      )}
      <div className="rounded-lg border border-line bg-panel p-3">
        <TokenChart
          mint={mint}
          priceUsd={token?.priceUsd ?? 0}
          mcap={token?.mcap ?? rec?.nowMcap ?? 0}
          callMcap={rec?.callMcap}
          calledAt={rec?.calledAt}
          pairUrl={pairUrl}
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
  const liveMcap = token.mcap > 0 ? token.mcap : (rec?.nowMcap ?? 0);
  const since = rec && rec.callMcap > 0 ? liveMcap / rec.callMcap : null;
  const peak = rec && rec.callMcap > 0 ? sanePeak(rec.callMcap, rec.nowMcap, rec.peakMcap, liveMcap, token.liq || rec.liq) / rec.callMcap : null;
  const reason = rec?.reasons[0] ?? token.reasons[0];
  const calledAgo = rec && now ? fmtAge(now - rec.calledAt) : null;
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
            {calledAgo ? <span>called {calledAgo}</span> : now && token.createdAt ? <span>{fmtAge(now - token.createdAt)}</span> : null}
            <span>{fmtUsd(token.mcap)}</span>
            {token.chgM5 !== 0 ? <span className={clsxPct(token.chgM5)}>5m {fmtPct(token.chgM5)}</span> : null}
            {note ? <span className="text-warn">{note}</span> : null}
          </span>
          {reason ? <span className="mt-1 block truncate text-xs text-muted">{reason}</span> : null}
        </span>
        <span className="shrink-0 text-right">
          {since ? (
            <>
              <span className={`block font-mono text-sm ${clsxPct(since - 1)}`}>{fmtX(since)}</span>
              <span className="block font-mono text-xs text-gold">{peak && peak > since + 0.05 ? `peak ${fmtX(peak)}` : "since call"}</span>
            </>
          ) : (
            <>
              <span className={`block font-mono text-sm ${clsxPct(token.chgH1)}`}>{fmtPct(token.chgH1)}</span>
              <span className="block font-mono text-xs text-dim">score {token.score}</span>
            </>
          )}
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
