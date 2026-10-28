import { scoreToken, type MarketToken, type ScanResult, type Scored, type SourceStatus, type Candle } from "./gate";

const IGNORE = new Set([
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
]);

interface DexPair {
  chainId?: string;
  dexId?: string;
  url?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  quoteToken?: { symbol?: string };
  priceUsd?: string;
  priceNative?: string;
  txns?: {
    m5?: { buys?: number; sells?: number };
    h1?: { buys?: number; sells?: number };
  };
  volume?: { m5?: number; h1?: number; h24?: number };
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  liquidity?: { usd?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: {
    imageUrl?: string;
    header?: string;
    websites?: { url?: string }[];
    socials?: { type?: string; url?: string }[];
  };
  boosts?: { active?: number };
}

interface DexMetaItem {
  chainId?: string;
  tokenAddress?: string;
  description?: string;
  icon?: string;
  links?: { type?: string; label?: string; url?: string }[];
  amount?: number;
  totalAmount?: number;
}

interface Meta {
  boosts: number;
  dexPaid: boolean;
  description?: string;
  icon?: string;
  twitter?: string;
  website?: string;
  telegram?: string;
}

async function geckoJson(url: string): Promise<unknown | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { accept: "application/json;version=20230203", "user-agent": "TalonsCalls/1.0" },
      });
      if (res.status === 429 && attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 800));
        continue;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

async function getJson(url: string, extra?: Record<string, string>): Promise<unknown | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        accept: "application/json",
        "user-agent": "Mozilla/5.0 (compatible; TalonsCalls/1.0)",
        ...extra,
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function num(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function httpUrl(value: unknown): string | undefined {
  return typeof value === "string" && value.startsWith("http") ? value : undefined;
}

function applyLinks(meta: Meta, links: { type?: string; label?: string; url?: string }[] | undefined) {
  for (const link of links ?? []) {
    const url = httpUrl(link.url);
    if (!url) continue;
    const kind = `${link.type ?? ""} ${link.label ?? ""}`.toLowerCase();
    if (!meta.twitter && (kind.includes("twitter") || kind.trim() === "x")) meta.twitter = url;
    else if (!meta.telegram && kind.includes("telegram")) meta.telegram = url;
    else if (!meta.website && (kind.includes("web") || kind.includes("site"))) meta.website = url;
  }
}

function emptyMeta(): Meta {
  return { boosts: 0, dexPaid: false };
}

function ingestMeta(map: Map<string, Meta>, items: DexMetaItem[], paid: boolean) {
  let count = 0;
  for (const item of items) {
    if (item.chainId !== "solana" || !item.tokenAddress || IGNORE.has(item.tokenAddress)) continue;
    count += 1;
    const meta = map.get(item.tokenAddress) ?? emptyMeta();
    const boost = Math.max(num(item.amount), num(item.totalAmount));
    if (boost > meta.boosts) meta.boosts = boost;
    if (paid) meta.dexPaid = true;
    if (!meta.description && item.description) meta.description = item.description.slice(0, 280);
    if (!meta.icon) meta.icon = httpUrl(item.icon);
    applyLinks(meta, item.links);
    map.set(item.tokenAddress, meta);
  }
  return count;
}

function geckoMints(payload: unknown): string[] {
  const data = asArray((payload as { data?: unknown } | null)?.data);
  const out: string[] = [];
  for (const row of data) {
    const id = (row as { relationships?: { base_token?: { data?: { id?: string } } } }).relationships?.base_token?.data?.id;
    if (!id?.startsWith("solana_")) continue;
    const mint = id.slice("solana_".length);
    if (mint && !IGNORE.has(mint)) out.push(mint);
  }
  return out;
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function pickPairs(pairs: DexPair[]): Map<string, DexPair> {
  const best = new Map<string, DexPair>();
  for (const pair of pairs) {
    if (pair.chainId !== "solana") continue;
    const mint = pair.baseToken?.address;
    if (!mint || IGNORE.has(mint)) continue;
    const prev = best.get(mint);
    const liq = num(pair.liquidity?.usd);
    const prevLiq = num(prev?.liquidity?.usd);
    if (!prev || liq > prevLiq) best.set(mint, pair);
  }
  return best;
}

function toToken(pair: DexPair, meta: Meta | undefined): MarketToken | null {
  const mint = pair.baseToken?.address;
  const symbol = pair.baseToken?.symbol?.trim();
  const name = pair.baseToken?.name?.trim();
  if (!mint || !symbol || !name) return null;
  const mcap = num(pair.marketCap) || num(pair.fdv);
  if (mcap <= 0) return null;
  const socials = meta ?? emptyMeta();
  for (const social of pair.info?.socials ?? []) {
    applyLinks(socials, [{ type: social.type, url: social.url }]);
  }
  if (!socials.website) socials.website = httpUrl(pair.info?.websites?.[0]?.url);
  const boosts = Math.max(socials.boosts, num(pair.boosts?.active));
  return {
    mint,
    name,
    symbol: symbol.replace(/^\$/, ""),
    image: httpUrl(pair.info?.imageUrl) ?? socials.icon,
    dex: pair.dexId || "dex",
    pairUrl: httpUrl(pair.url) ?? `https://dexscreener.com/solana/${mint}`,
    mcap,
    fdv: num(pair.fdv) || mcap,
    liq: num(pair.liquidity?.usd),
    priceUsd: num(pair.priceUsd),
    volM5: num(pair.volume?.m5),
    volH1: num(pair.volume?.h1),
    volH24: num(pair.volume?.h24),
    chgM5: num(pair.priceChange?.m5),
    chgH1: num(pair.priceChange?.h1),
    chgH6: num(pair.priceChange?.h6),
    chgH24: num(pair.priceChange?.h24),
    buysM5: num(pair.txns?.m5?.buys),
    sellsM5: num(pair.txns?.m5?.sells),
    buysH1: num(pair.txns?.h1?.buys),
    sellsH1: num(pair.txns?.h1?.sells),
    createdAt: num(pair.pairCreatedAt),
    boosts,
    dexPaid: socials.dexPaid || Boolean(pair.info?.header) || boosts > 0,
    twitter: socials.twitter,
    website: socials.website,
    telegram: socials.telegram,
    description: socials.description,
  };
}

function solSamples(pairs: DexPair[]): number[] {
  const samples: number[] = [];
  for (const pair of pairs) {
    if (pair.quoteToken?.symbol !== "SOL") continue;
    const usd = num(pair.priceUsd);
    const native = num(pair.priceNative);
    if (usd > 0 && native > 0) {
      const sol = usd / native;
      if (sol > 8 && sol < 5_000) samples.push(sol);
    }
  }
  return samples;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function pairsFor(mints: string[]): Promise<{ pairs: DexPair[]; ok: boolean }> {
  const groups = await Promise.all(
    chunks(mints, 30).map((group) => getJson(`https://api.dexscreener.com/latest/dex/tokens/${group.join(",")}`)),
  );
  const pairs: DexPair[] = [];
  let ok = false;
  for (const payload of groups) {
    const list = asArray((payload as { pairs?: unknown } | null)?.pairs) as DexPair[];
    if (payload) ok = true;
    pairs.push(...list);
  }
  return { pairs, ok };
}

export async function quotesFor(mints: string[]): Promise<Scored[]> {
  const unique = [...new Set(mints)].filter((mint) => !IGNORE.has(mint)).slice(0, 60);
  if (!unique.length) return [];
  const { pairs } = await pairsFor(unique);
  const best = pickPairs(pairs);
  const now = Date.now();
  return [...best.values()]
    .map((pair) => {
      const token = toToken(pair, undefined);
      return token ? scoreToken(token, now) : null;
    })
    .filter((token): token is Scored => token !== null);
}

function rank(tokens: Scored[]): Scored[] {
  const fresh = tokens
    .filter((token) => token.called && token.path === "fresh")
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  const rest = tokens
    .filter((token) => token.called && token.path !== "fresh")
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  const kept = new Set([...fresh, ...rest].map((token) => token.mint));
  return tokens
    .map((token) => {
      if (!token.called || kept.has(token.mint)) return token;
      return {
        ...token,
        called: false,
        path: null,
        tier: null,
        blockers: ["Held — only a few early names with room get a call"],
      };
    })
    .sort((a, b) => Number(b.called) - Number(a.called) || b.score - a.score || b.volH1 - a.volH1)
    .slice(0, 80);
}

let cachedScan: { at: number; value: ScanResult } | null = null;
const candleCache = new Map<string, { at: number; rows: Candle[] }>();

export async function buildScan(): Promise<ScanResult> {
  const now = Date.now();
  if (cachedScan && now - cachedScan.at < 12_000 && cachedScan.value.tokens.length) return cachedScan.value;
  const value = await scanFresh();
  if (value.tokens.length) cachedScan = { at: now, value };
  return value;
}

async function pumpClimbers(now: number): Promise<string[]> {
  const pages = await Promise.all(
    [0, 40, 80].map((offset) =>
      getJson(
        `https://frontend-api-v3.pump.fun/coins?offset=${offset}&limit=40&sort=created_timestamp&order=DESC&includeNsfw=false`,
        { origin: "https://pump.fun", referer: "https://pump.fun/" },
      ),
    ),
  );
  const picks: { mint: string; mcap: number; age: number }[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    for (const row of asArray(page)) {
      if (!row || typeof row !== "object") continue;
      const coin = row as {
        mint?: string;
        created_timestamp?: number;
        usd_market_cap?: number;
        nsfw?: boolean;
        is_banned?: boolean;
        hidden?: boolean;
      };
      const mint = coin.mint;
      if (!mint || seen.has(mint) || IGNORE.has(mint) || coin.nsfw || coin.is_banned || coin.hidden) continue;
      const age = coin.created_timestamp ? (now - coin.created_timestamp) / 60_000 : 9_999;
      const mcap = num(coin.usd_market_cap);
      if (age < 3 || age > 120 || mcap < 8_000 || mcap > 150_000) continue;
      seen.add(mint);
      picks.push({ mint, mcap, age });
    }
  }
  const young = [...picks].sort((a, b) => a.age - b.age).slice(0, 8);
  const big = [...picks].sort((a, b) => b.mcap - a.mcap).slice(0, 8);
  const out: string[] = [];
  for (const row of [...young, ...big]) {
    if (out.includes(row.mint)) continue;
    out.push(row.mint);
  }
  return out;
}

async function scanFresh(): Promise<ScanResult> {
  const now = Date.now();
  const [boostsTop, boostsLatest, profiles, trending, freshPools, curve] = await Promise.all([
    getJson("https://api.dexscreener.com/token-boosts/top/v1"),
    getJson("https://api.dexscreener.com/token-boosts/latest/v1"),
    getJson("https://api.dexscreener.com/token-profiles/latest/v1"),
    getJson("https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?page=1"),
    getJson("https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=1"),
    pumpClimbers(now),
  ]);

  const meta = new Map<string, Meta>();
  const boostCount =
    ingestMeta(meta, asArray(boostsTop) as DexMetaItem[], false) +
    ingestMeta(meta, asArray(boostsLatest) as DexMetaItem[], false);
  const profileCount = ingestMeta(meta, asArray(profiles) as DexMetaItem[], true);
  const trendMints = geckoMints(trending);
  const newMints = geckoMints(freshPools);

  const ordered = [...curve, ...newMints.slice(0, 16), ...trendMints.slice(0, 12), ...[...meta.keys()].slice(0, 8)];
  const seen = new Set<string>();
  const mints: string[] = [];
  for (const mint of ordered) {
    if (seen.has(mint) || IGNORE.has(mint)) continue;
    seen.add(mint);
    mints.push(mint);
    if (mints.length >= 60) break;
  }

  const { pairs, ok: dexOk } = mints.length ? await pairsFor(mints) : { pairs: [] as DexPair[], ok: false };
  let best = pickPairs(pairs);
  let tokens = rank(
    [...best.values()]
      .map((pair) => {
        const token = toToken(pair, meta.get(pair.baseToken?.address ?? ""));
        return token ? scoreToken(token, now) : null;
      })
      .filter((token): token is Scored => token !== null),
  );

  let fallbackOk = false;
  if (!tokens.length) {
    const payload = await getJson("https://api.dexscreener.com/latest/dex/search?q=pump");
    const found = asArray((payload as { pairs?: unknown } | null)?.pairs) as DexPair[];
    const solana = found.filter((pair) => pair.chainId === "solana");
    if (solana.length) {
      best = pickPairs(solana);
      tokens = rank(
        [...best.values()]
          .map((pair) => {
            const token = toToken(pair, meta.get(pair.baseToken?.address ?? ""));
            return token ? scoreToken(token, now) : null;
          })
          .filter((token): token is Scored => token !== null),
      );
      pairs.push(...solana);
      fallbackOk = tokens.length > 0;
    }
  }

  const sources: SourceStatus[] = [
    { id: "boosts", label: "Dex boosts", ok: Boolean(boostsTop || boostsLatest), count: boostCount },
    { id: "profiles", label: "Dex profiles", ok: Boolean(profiles), count: profileCount },
    { id: "trending", label: "Trending pools", ok: Boolean(trending), count: trendMints.length },
    { id: "new", label: "New pools", ok: Boolean(freshPools), count: newMints.length },
    { id: "curve", label: "Curve climbers", ok: curve.length > 0, count: curve.length },
    { id: "pairs", label: "Pair quotes", ok: dexOk || fallbackOk, count: tokens.length },
  ];

  return {
    tokens,
    solUsd: median(solSamples(pairs)),
    scannedAt: now,
    sources,
    error: tokens.length ? null : "Market data did not come back. Retry in a few seconds.",
    shared: false,
    book: [],
  };
}

export async function buildSearch(query: string): Promise<Scored[]> {
  const q = query.trim().slice(0, 48);
  if (q.length < 2) return [];
  const payload = await getJson(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`);
  const pairs = asArray((payload as { pairs?: unknown } | null)?.pairs) as DexPair[];
  const best = pickPairs(pairs.filter((pair) => pair.chainId === "solana"));
  const now = Date.now();
  return rank(
    [...best.values()]
      .map((pair) => {
        const token = toToken(pair, undefined);
        return token ? scoreToken(token, now) : null;
      })
      .filter((token): token is Scored => token !== null),
  ).slice(0, 12);
}

function bucketCandles(rows: Candle[], minutes: number): Candle[] {
  const size = minutes * 60_000;
  const buckets = new Map<number, Candle>();
  for (const candle of [...rows].sort((a, b) => a.t - b.t)) {
    const t = Math.floor(candle.t / size) * size;
    const bar = buckets.get(t);
    if (!bar) {
      buckets.set(t, { t, o: candle.o, h: candle.h, l: candle.l, c: candle.c });
      continue;
    }
    bar.h = Math.max(bar.h, candle.h);
    bar.l = Math.min(bar.l, candle.l);
    bar.c = candle.c;
  }
  return [...buckets.values()];
}

export async function buildCandles(mint: string, aggregate = 1, pair = ""): Promise<Candle[]> {
  const span = aggregate === 15 ? 15 : aggregate === 5 ? 5 : 1;
  if (span === 15) return bucketCandles(await loadSpan(mint, 5, pair), 15);
  return loadSpan(mint, span, pair);
}

async function loadSpan(mint: string, span: number, pair: string): Promise<Candle[]> {
  const key = `${mint}:${span}`;
  const hit = candleCache.get(key);
  if (hit && Date.now() - hit.at < 90_000) return hit.rows;
  const rows = await candlesFresh(mint, span, pair);
  if (rows.length) candleCache.set(key, { at: Date.now(), rows });
  return rows;
}

function deepestPool(payload: unknown): string | null {
  let best = "";
  let bestUsd = -1;
  for (const row of asArray((payload as { data?: unknown } | null)?.data)) {
    const attr = (row as { attributes?: { address?: string; reserve_in_usd?: string } }).attributes;
    if (!attr?.address) continue;
    const usd = num(attr.reserve_in_usd);
    if (usd >= bestUsd) {
      bestUsd = usd;
      best = attr.address;
    }
  }
  return best || null;
}

async function readOhlcv(pool: string, aggregate: number): Promise<Candle[]> {
  const ohlcv = await geckoJson(
    `https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/ohlcv/minute?aggregate=${aggregate}&limit=240&currency=usd`,
  );
  const list = (ohlcv as { data?: { attributes?: { ohlcv_list?: unknown } } } | null)?.data?.attributes?.ohlcv_list;
  if (!Array.isArray(list)) return [];
  const candles: Candle[] = [];
  for (const row of list) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const raw = num(row[0]);
    const t = raw > 1e12 ? raw : raw * 1000;
    const o = num(row[1]);
    const h = num(row[2]);
    const l = num(row[3]);
    const c = num(row[4]);
    if (t > 0 && c > 0 && h > 0 && l > 0) candles.push({ t, o, h, l, c });
  }
  candles.sort((a, b) => a.t - b.t);
  return candles;
}

async function candlesFresh(mint: string, aggregate: number, pair = ""): Promise<Candle[]> {
  if (pair) {
    const direct = await readOhlcv(pair, aggregate);
    if (direct.length >= 2) return direct;
  }
  const pools = await geckoJson(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/${mint}/pools?page=1`);
  const pool = deepestPool(pools);
  if (!pool || pool === pair) return [];
  return readOhlcv(pool, aggregate);
}
