export type RiskRead = {
  mint: string;
  state: "clean" | "warn" | "rug" | "checking";
  score: number | null;
  lpLockedPct: number | null;
  risks: string[];
  gem: boolean;
};

const cache = new Map<string, { at: number; value: RiskRead }>();

function checking(mint: string): RiskRead {
  return { mint, state: "checking", score: null, lpLockedPct: null, risks: [], gem: false };
}

export async function readRisk(mint: string): Promise<RiskRead> {
  const hit = cache.get(mint);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.value;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`, {
      signal: ctrl.signal,
      headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; TalonsCalls/1.0)" },
    });
    if (!res.ok) return checking(mint);
    const body = (await res.json()) as {
      score_normalised?: number;
      lpLockedPct?: number;
      risks?: { name?: string; level?: string }[];
    };
    const risks = Array.isArray(body.risks) ? body.risks : [];
    const names = risks.map((row) => row.name).filter((name): name is string => Boolean(name));
    const danger = risks.some((row) => {
      const level = (row.level ?? "").toLowerCase();
      return level === "danger" || level === "error" || level === "critical";
    });
    const lp = typeof body.lpLockedPct === "number" ? body.lpLockedPct : null;
    const state = danger ? "rug" : names.length === 0 && (lp === null || lp >= 50) ? "clean" : "warn";
    const value: RiskRead = {
      mint,
      state,
      score: typeof body.score_normalised === "number" ? body.score_normalised : null,
      lpLockedPct: lp,
      risks: names.slice(0, 4),
      gem: state === "clean" && (lp ?? 0) >= 90 && names.length === 0,
    };
    cache.set(mint, { at: Date.now(), value });
    return value;
  } catch {
    return checking(mint);
  } finally {
    clearTimeout(timer);
  }
}
