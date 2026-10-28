import { useEffect, useRef, useState } from "react";
import type { AutoscaleInfoProvider } from "lightweight-charts";
import type { Candle } from "@/lib/gate";
import { fmtUsd } from "@/lib/format";
import { loadCandles } from "@/lib/market-fns";

function pairOf(url?: string): string {
  if (!url) return "";
  const last = url.split("?")[0].split("/").filter(Boolean).pop() ?? "";
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(last) ? last : "";
}

export function TokenChart({
  mint,
  priceUsd,
  mcap,
  callMcap,
  calledAt,
  pairUrl,
}: {
  mint: string;
  priceUsd: number;
  mcap: number;
  callMcap?: number;
  calledAt?: number;
  pairUrl?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [span, setSpan] = useState<1 | 5 | 15>(5);
  const [status, setStatus] = useState<"loading" | "empty" | "ready">("loading");
  const [note, setNote] = useState("");
  const [useEmbed, setUseEmbed] = useState(false);
  const [beat, setBeat] = useState(0);
  const pair = pairOf(pairUrl);
  const drawn = useRef<1 | 5 | 15>(5);
  const closeChart = useRef(() => {});

  useEffect(() => {
    const id = window.setInterval(() => setBeat((value) => value + 1), 45_000);
    return () => window.clearInterval(id);
  }, [mint]);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    let dead = false;
    if (!closeChart.current) setStatus("loading");

    void (async () => {
      let rows: Candle[] = [];
      try {
        rows = await loadCandles({ data: { mint, aggregate: span, pair } });
      } catch {
        rows = [];
      }
      if (dead || !host.current) return;
      if (rows.length < 2) {
        if (!closeChart.current || drawn.current === span) {
          setUseEmbed(true);
          setNote("");
          setStatus("ready");
        } else setNote("That timeframe did not load.");
        return;
      }
      setUseEmbed(false);

      const { CandlestickSeries, ColorType, CrosshairMode, LineStyle, createChart, createSeriesMarkers } = await import("lightweight-charts");
      if (dead || !host.current) return;
      closeChart.current();

      const lastClose = rows[rows.length - 1]?.c ?? 0;
      const scale = lastClose > 0 && mcap > 0 ? mcap / lastClose : priceUsd > 0 && mcap > 0 ? mcap / priceUsd : 1;
      const seen = new Set<number>();
      const bars: { time: number; open: number; high: number; low: number; close: number }[] = [];
      for (const candle of rows) {
        const time = Math.floor(candle.t / 1000);
        if (seen.has(time)) continue;
        seen.add(time);
        const body = Math.max(candle.o, candle.c);
        bars.push({
          time,
          open: candle.o * scale,
          high: Math.min(Math.max(candle.h, body), body * 8) * scale,
          low: Math.max(Math.min(candle.l, body), body / 8) * scale,
          close: candle.c * scale,
        });
      }
      bars.sort((a, b) => a.time - b.time);
      if (bars.length < 2) {
        setStatus("empty");
        return;
      }

      const chart = createChart(host.current, {
        autoSize: true,
        layout: {
          background: { type: ColorType.Solid, color: "#0b0d12" },
          textColor: "#9aa3b2",
          fontFamily: "IBM Plex Mono, ui-monospace, monospace",
          fontSize: 11,
          attributionLogo: true,
        },
        grid: {
          vertLines: { color: "#161b24" },
          horzLines: { color: "#161b24" },
        },
        rightPriceScale: { borderColor: "#222836" },
        timeScale: { borderColor: "#222836", timeVisible: true, secondsVisible: false },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: {
            visible: true,
            color: "#c5ceda",
            width: 1,
            style: LineStyle.Dashed,
            labelBackgroundColor: "#171a21",
          },
          horzLine: {
            visible: true,
            color: "#ef5350",
            width: 1,
            style: LineStyle.Dotted,
            labelBackgroundColor: "#ef5350",
          },
        },
      });
      const series = chart.addSeries(CandlestickSeries, {
        upColor: "#26a69a",
        downColor: "#ef5350",
        borderUpColor: "#26a69a",
        borderDownColor: "#ef5350",
        wickUpColor: "#26a69a",
        wickDownColor: "#ef5350",
        priceFormat: {
          type: "custom",
          minMove: 1,
          formatter: (price: number) => fmtUsd(price),
        },
        autoscaleInfoProvider: ((base) => {
          const info = base();
          if (!info?.priceRange || !(callMcap && callMcap > 0)) return info;
          return {
            priceRange: {
              minValue: Math.min(info.priceRange.minValue, callMcap * 0.92),
              maxValue: Math.max(info.priceRange.maxValue, callMcap * 1.04),
            },
          };
        }) satisfies AutoscaleInfoProvider,
      });
      series.setData(bars.map((bar) => ({ ...bar, time: bar.time as never })));

      if (callMcap && callMcap > 0) {
        series.createPriceLine({
          price: callMcap,
          color: "#ef5350",
          lineWidth: 1,
          lineStyle: 1,
          axisLabelVisible: true,
          title: "",
        });
        let nearest = bars[0].time;
        if (calledAt && calledAt > 0) {
          const target = calledAt / 1000;
          let best = Infinity;
          for (const bar of bars) {
            const dist = Math.abs(bar.time - target);
            if (dist < best) {
              best = dist;
              nearest = bar.time;
            }
          }
          if (target < bars[0].time) nearest = bars[0].time;
        }
        createSeriesMarkers(series, [
          {
            time: nearest as never,
            position: "belowBar",
            color: "#ef5350",
            shape: "arrowUp",
            text: `Called ${fmtUsd(callMcap)}`,
          },
        ]);
      }

      chart.timeScale().fitContent();
      drawn.current = span;
      setNote("");
      setStatus("ready");
      closeChart.current = () => chart.remove();
    })();

    return () => {
      dead = true;
    };
  }, [mint, span, pair, priceUsd, mcap, callMcap, calledAt, beat]);

  useEffect(() => () => closeChart.current(), []);

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        {([1, 5, 15] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setSpan(item)}
            className={`h-8 rounded-full px-3 font-mono text-xs ${span === item ? "bg-row text-fg" : "text-dim"}`}
          >
            {item}m
          </button>
        ))}
        <p className="ml-auto font-mono text-[10px] tracking-widest text-dim uppercase">Market cap</p>
      </div>
      {note ? <p className="mb-2 font-mono text-xs text-warn">{note}</p> : null}
      <div className="relative h-[28rem] overflow-hidden rounded-lg bg-[#0b0d12]">
        {useEmbed ? (
          <iframe
            title="Market cap chart"
            src={`https://dexscreener.com/solana/${pair || mint}?embed=1&theme=dark&chartTheme=dark&chartStyle=1&chartType=usd&interval=${span}&info=0&trades=0`}
            className="h-full w-full border-0"
            allow="clipboard-write; fullscreen"
            loading="lazy"
          />
        ) : (
          <>
            {status === "loading" && <div className="absolute inset-0 animate-pulse bg-[#11151c]" />}
            {status === "empty" && (
              <div className="absolute inset-0 grid place-items-center px-4 text-center text-sm text-muted">
                Chart data did not come back. Try again in a moment.
              </div>
            )}
            <div ref={host} className={`h-full w-full ${status === "ready" ? "" : "invisible"}`} />
          </>
        )}
      </div>
    </div>
  );
}
