import { useEffect, useMemo, useState } from "react";
import type { Candle } from "@/lib/gate";
import { fmtUsd } from "@/lib/format";
import { loadCandles } from "@/lib/market-fns";

const W = 360;
const H = 228;
const PAD = { l: 8, r: 54, t: 18, b: 22 };

export function TokenChart({
  mint,
  priceUsd,
  mcap,
  callMcap,
  calledAt,
}: {
  mint: string;
  priceUsd: number;
  mcap: number;
  callMcap?: number;
  calledAt?: number;
}) {
  const [span, setSpan] = useState<1 | 5>(1);
  const [raw, setRaw] = useState<Candle[] | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    setRaw(null);
    void loadCandles({ data: { mint, aggregate: span } })
      .then((rows) => {
        if (live) setRaw(rows);
      })
      .catch(() => {
        if (live) setRaw([]);
      });
    return () => {
      live = false;
    };
  }, [mint, span]);

  const asMcap = priceUsd > 0 && mcap > 0;
  const scale = asMcap ? mcap / priceUsd : 1;
  const candles = useMemo(() => {
    if (!raw) return [];
    return raw.map((candle) => ({
      t: candle.t,
      o: candle.o * scale,
      h: candle.h * scale,
      l: candle.l * scale,
      c: candle.c * scale,
    }));
  }, [raw, scale]);

  const call = callMcap && callMcap > 0 ? callMcap : null;

  if (!raw) return <div className="h-64 animate-pulse rounded-lg bg-row" />;
  if (candles.length < 2) {
    return (
      <div className="grid h-64 place-items-center rounded-lg border border-line bg-row px-4 text-center text-sm text-muted">
        Candles did not load. The pair link below still has the live chart.
      </div>
    );
  }

  const lows = candles.map((candle) => candle.l);
  const highs = candles.map((candle) => candle.h);
  let min = Math.min(...lows);
  let max = Math.max(...highs);
  if (call) {
    min = Math.min(min, call);
    max = Math.max(max, call);
  }
  if (max === min) {
    max += min * 0.02 || 1;
    min -= min * 0.02 || 1;
  }
  const pad = (max - min) * 0.1;
  min -= pad;
  max += pad;

  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const slot = innerW / candles.length;
  const yOf = (value: number) => PAD.t + ((max - value) / (max - min)) * innerH;
  const xOf = (index: number) => PAD.l + slot * index + slot / 2;

  let callIndex = 0;
  if (calledAt && calledAt > 0) {
    let best = Infinity;
    candles.forEach((candle, index) => {
      const dist = Math.abs(candle.t - calledAt);
      if (dist < best) {
        best = dist;
        callIndex = index;
      }
    });
    if (calledAt < candles[0].t) callIndex = 0;
  }
  const callY = call ? yOf(call) : null;
  const callX = call ? xOf(call ? callIndex : 0) : null;
  const active = hover != null ? candles[hover] : candles[candles.length - 1];
  const activeUp = active.c >= active.o;

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        {([1, 5] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setSpan(item)}
            className={`h-8 rounded-full px-3 font-mono text-xs ${span === item ? "bg-row text-fg" : "text-dim"}`}
          >
            {item}m
          </button>
        ))}
        <p className={`ml-auto hidden font-mono text-xs sm:block ${activeUp ? "text-flow" : "text-warn"}`}>
          O {fmtUsd(active.o)} H {fmtUsd(active.h)} L {fmtUsd(active.l)} C {fmtUsd(active.c)}
        </p>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-64 w-full touch-none"
        role="img"
        aria-label={asMcap ? "Market cap candles" : "Price candles"}
        onPointerLeave={() => setHover(null)}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const x = ((event.clientX - rect.left) / rect.width) * W;
          const index = Math.min(candles.length - 1, Math.max(0, Math.floor((x - PAD.l) / slot)));
          setHover(index);
        }}
      >
        {[0, 0.5, 1].map((step) => {
          const value = max - (max - min) * step;
          const y = yOf(value);
          return (
            <g key={step}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} stroke="var(--color-line)" strokeDasharray="2 4" />
              <text x={W - 4} y={y + 3} textAnchor="end" fill="var(--color-dim)" fontSize="9" fontFamily="ui-monospace, monospace">
                {fmtUsd(value)}
              </text>
            </g>
          );
        })}
        {candles.map((candle, index) => {
          const up = candle.c >= candle.o;
          const color = up ? "var(--color-flow)" : "var(--color-warn)";
          const x = xOf(index);
          const bodyTop = yOf(Math.max(candle.o, candle.c));
          const bodyBot = yOf(Math.min(candle.o, candle.c));
          const bodyH = Math.max(1, bodyBot - bodyTop);
          return (
            <g key={candle.t}>
              <line x1={x} x2={x} y1={yOf(candle.h)} y2={yOf(candle.l)} stroke={color} strokeWidth="1" />
              <rect x={x - Math.max(1.2, slot * 0.28)} y={bodyTop} width={Math.max(2.4, slot * 0.56)} height={bodyH} fill={color} />
            </g>
          );
        })}
        {call && callY != null && callX != null && (
          <g>
            <line x1={PAD.l} x2={W - PAD.r} y1={callY} y2={callY} stroke="var(--color-gold)" strokeDasharray="4 3" strokeWidth="1" />
            <circle cx={callX} cy={callY} r="3.5" fill="var(--color-gold)" />
            <rect x={Math.min(callX + 6, W - PAD.r - 92)} y={Math.max(PAD.t, callY - 22)} width="90" height="16" rx="4" fill="var(--color-panel)" stroke="var(--color-gold)" />
            <text
              x={Math.min(callX + 10, W - PAD.r - 88)}
              y={Math.max(PAD.t, callY - 22) + 11}
              fill="var(--color-gold)"
              fontSize="8"
              fontFamily="ui-monospace, monospace"
            >
              Called {fmtUsd(call)}
            </text>
          </g>
        )}
        <text x={PAD.l} y={H - 6} fill="var(--color-dim)" fontSize="9" fontFamily="ui-monospace, monospace">
          {new Date(candles[0].t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </text>
        <text x={W - PAD.r} y={H - 6} textAnchor="end" fill="var(--color-dim)" fontSize="9" fontFamily="ui-monospace, monospace">
          {new Date(candles[candles.length - 1].t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </text>
      </svg>
      <p className="mt-1 font-mono text-[10px] tracking-widest text-dim uppercase">{asMcap ? "Market cap" : "Price"} · public 1m candles, not the trade tape</p>
    </div>
  );
}
