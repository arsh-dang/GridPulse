import fs from "node:fs";
import path from "node:path";
import { decide, type BatteryTelemetry, type DispatchAction, type PolicyConfig } from "@gridpulse/shared";
import { Fleet } from "../fleet/fleetModel.js";
import { mulberry32 } from "../fleet/rng.js";
import { ReportingPolicy, type PriceClass, type ReportingConfig, type ReportingMode } from "../edge/reportingPolicy.js";

/**
 * Offline experiment: how much telemetry can an edge gateway suppress, and
 * what does it cost in dispatch quality?
 *
 * Every configuration runs the same seeded fleet through the same 30-minute
 * price scenario. The cloud optimiser is modelled exactly as deployed: it
 * decides a battery only when that battery's telemetry arrives, using the
 * shared `decide` policy and the current regional price, and the battery
 * then follows that decision until the next one. The reference is an
 * oracle that re-decides every battery every second from its true state.
 *
 *   npx tsx src/experiments/edgeEval.ts            (5,000 batteries)
 *   FLEET=2000 npx tsx src/experiments/edgeEval.ts
 */
const FLEET = Number(process.env.FLEET ?? 5000);
const SAMPLE_S = 5;           // how often each battery samples (and, in the baseline, reports)
const DURATION_S = 1800;
const START_HOUR = 17.5;      // late afternoon, when NEM evening peaks happen
const OUT = path.resolve(process.env.OUT_DIR ?? "results");

const POLICY: PolicyConfig = {
  spikeThresholdAudMwh: 300,
  cheapThresholdAudMwh: 50,
  reserveSoc: 0.2,
  fullSoc: 0.95,
  maxKw: 5,
  priceMaxAgeMs: 15 * 60_000,
};

// 5 min normal, 15 min spike, 5 min normal, 5 min cheap.
const SPIKE_START = 300, SPIKE_END = 1200, CHEAP_START = 1500;
function priceAt(t: number): number {
  if (t >= SPIKE_START && t < SPIKE_END) return 450;
  if (t >= CHEAP_START) return 30;
  return 120;
}
function classOf(p: number): PriceClass {
  return p >= POLICY.spikeThresholdAudMwh ? "spike" : p <= POLICY.cheapThresholdAudMwh ? "cheap" : "normal";
}

interface Result {
  label: string;
  mode: ReportingMode;
  deltaPct: number;
  heartbeatS: number;
  messages: number;
  msgPerBatteryMin: number;
  reductionPct: number;
  agreementPct: number;
  spikeExportKwh: number;
  spikeRevenueAud: number;
  offSpikeExportKwh: number;
  reactionMeanS: number;
  reactionP95S: number;
  reactionMaxS: number;
  meanReportAgeS: number;
  reserveViolations: number;
  maxDepthBelowReservePct: number;
  triggers: string;
  series: number[]; // messages per 10 s
}

function run(label: string, cfg: ReportingConfig, baselineMessages?: number): Result {
  const fleet = new Fleet({ size: FLEET, region: "VIC", seed: 42 });
  const policy = new ReportingPolicy(cfg);
  const ids = fleet.batteries.map((b) => b.id);
  const lastReportAt = new Float64Array(FLEET).fill(0);
  const reactedAt = new Float64Array(FLEET).fill(NaN);
  const eligibleAtSpike = new Uint8Array(FLEET);
  const series = new Array(Math.ceil(DURATION_S / 10)).fill(0);

  // Start mid-operation: each battery last reported at a random time within
  // one heartbeat, so heartbeats are spread across the fleet as they would be
  // on a gateway that has been running for a while.
  const phase = mulberry32(7);
  if (cfg.mode !== "periodic") {
    fleet.batteries.forEach((b, i) => {
      const ago = Math.floor(phase() * cfg.heartbeatS);
      policy.prime(b.id, b.soc, -ago);
      lastReportAt[i] = -ago;
    });
  }

  let messages = 0, agree = 0, ticks = 0, ageSum = 0;
  let spikeExportKwh = 0, spikeRevenue = 0, offSpikeExportKwh = 0, violations = 0, minSoc = 1;
  const violated = new Uint8Array(FLEET);

  for (let t = 0; t < DURATION_S; t++) {
    const price = priceAt(t);
    const hour = START_HOUR + t / 3600;
    const now = new Date(Date.UTC(2026, 8, 25, 7, 30) + t * 1000);
    const priceState = { priceAudMwh: price, intervalStart: now.toISOString() };
    policy.onPrice(classOf(price), ids);

    if (t === SPIKE_START) {
      fleet.batteries.forEach((b, i) => { eligibleAtSpike[i] = b.soc > POLICY.reserveSoc ? 1 : 0; });
    }

    for (let i = 0; i < FLEET; i++) {
      const b = fleet.batteries[i]!;

      // The battery samples every SAMPLE_S seconds, staggered across the fleet.
      if ((t + i) % SAMPLE_S === 0 && policy.decide(b.id, b.soc, t)) {
        messages++;
        series[Math.floor(t / 10)]++;
        lastReportAt[i] = t;
        const telemetry: BatteryTelemetry = {
          type: "BatteryTelemetry", batteryId: b.id, region: "VIC",
          soc: b.soc, solarKw: 0, loadKw: b.baseLoadKw, ts: now.toISOString(),
        };
        const d = decide(telemetry, priceState, POLICY, now);
        b.command = { action: d.action, targetKw: d.targetKw ?? 0 };
      }

      // Oracle: what the policy would say with perfect, instant information.
      const ideal: DispatchAction = decide(
        { type: "BatteryTelemetry", batteryId: b.id, region: "VIC", soc: b.soc, solarKw: 0, loadKw: 0, ts: now.toISOString() },
        priceState, POLICY, now,
      ).action;
      if (ideal === b.command.action) agree++;
      ticks++;
      ageSum += t - lastReportAt[i]!;

      if (t >= SPIKE_START && eligibleAtSpike[i] && Number.isNaN(reactedAt[i]!) && b.command.action === "DISCHARGE") {
        reactedAt[i] = t - SPIKE_START;
      }

      if (b.command.action === "DISCHARGE") {
        const kwh = b.command.targetKw / 3600;
        if (t >= SPIKE_START && t < SPIKE_END) {
          spikeExportKwh += kwh;
          spikeRevenue += (kwh / 1000) * price;
        } else offSpikeExportKwh += kwh;
      }

      fleet.step(b, 1, hour, POLICY.reserveSoc);
      if (b.soc < POLICY.reserveSoc - 1e-9) {
        if (!violated[i]) { violated[i] = 1; violations++; }
        if (b.soc < minSoc) minSoc = b.soc;
      }
    }
  }

  const reactions = [...reactedAt].filter((v, i) => eligibleAtSpike[i] && !Number.isNaN(v)).sort((a, b) => a - b);
  const pct = (q: number) => reactions[Math.min(reactions.length - 1, Math.floor(q * reactions.length))] ?? NaN;
  const counts = Object.entries(policy.counts).filter(([, n]) => n > 0).map(([k, n]) => `${k}:${n}`).join(" ");
  return {
    label, mode: cfg.mode, deltaPct: cfg.delta * 100, heartbeatS: cfg.heartbeatS,
    messages,
    msgPerBatteryMin: messages / FLEET / (DURATION_S / 60),
    reductionPct: baselineMessages ? (1 - messages / baselineMessages) * 100 : 0,
    agreementPct: (agree / ticks) * 100,
    spikeExportKwh, spikeRevenueAud: spikeRevenue, offSpikeExportKwh,
    reactionMeanS: reactions.reduce((a, b) => a + b, 0) / reactions.length,
    reactionP95S: pct(0.95), reactionMaxS: reactions[reactions.length - 1] ?? NaN,
    meanReportAgeS: ageSum / ticks,
    reserveViolations: violations,
    maxDepthBelowReservePct: violations ? (POLICY.reserveSoc - minSoc) * 100 : 0,
    triggers: counts,
    series,
  };
}

const boundaries = [POLICY.reserveSoc, POLICY.fullSoc];
const cfg = (mode: ReportingMode, delta: number, heartbeatS: number): ReportingConfig => ({ mode, delta, heartbeatS, boundaries });

const t0 = Date.now();
const results: Result[] = [];
const base = run("periodic", cfg("periodic", 0, 0));
results.push(base);
for (const hb of [30, 60, 120, 300]) results.push(run(`sod d=1% hb=${hb}`, cfg("sod", 0.01, hb), base.messages));
for (const hb of [30, 60, 120, 300]) results.push(run(`sod-aware d=1% hb=${hb}`, cfg("sod-aware", 0.01, hb), base.messages));
// Ablation: price-class flush only, no SoC boundary triggers.
for (const hb of [60, 300]) results.push(run(`price-only d=1% hb=${hb}`, { mode: "sod-aware", delta: 0.01, heartbeatS: hb, boundaries: [] }, base.messages));
// Delta sensitivity where it matters (long heartbeat).
for (const d of [0.005, 0.02]) results.push(run(`sod-aware d=${d * 100}% hb=300`, cfg("sod-aware", d, 300), base.messages));

fs.mkdirSync(OUT, { recursive: true });
const cols: (keyof Result)[] = ["label", "mode", "deltaPct", "heartbeatS", "messages", "msgPerBatteryMin", "reductionPct", "agreementPct",
  "spikeExportKwh", "spikeRevenueAud", "offSpikeExportKwh", "reactionMeanS", "reactionP95S", "reactionMaxS", "meanReportAgeS", "reserveViolations", "maxDepthBelowReservePct", "triggers"];
const fmt = (v: unknown) => (typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(3)) : `"${String(v)}"`);
fs.writeFileSync(path.join(OUT, "edge-eval.csv"), [cols.join(","), ...results.map((r) => cols.map((c) => fmt(r[c])).join(","))].join("\n") + "\n");

const pick = ["periodic", "sod d=1% hb=120", "sod-aware d=1% hb=120"];
const seriesRows = base.series.map((_, k) => [k * 10, ...pick.map((l) => results.find((r) => r.label === l)!.series[k])].join(","));
fs.writeFileSync(path.join(OUT, "edge-timeseries.csv"), ["t_s," + pick.map((l) => `"${l}"`).join(","), ...seriesRows].join("\n") + "\n");

console.log(`Fleet ${FLEET}, ${DURATION_S}s scenario, sample every ${SAMPLE_S}s, ${((Date.now() - t0) / 1000).toFixed(1)}s runtime\n`);
console.log("config                     msgs/batt/min  reduction  agree%  spike kWh  off-spike kWh  react mean/p95/max s  age s  viol depth%  triggers");
for (const r of results) {
  console.log(
    `${r.label.padEnd(26)} ${r.msgPerBatteryMin.toFixed(2).padStart(13)} ${r.reductionPct.toFixed(1).padStart(9)}% ${r.agreementPct.toFixed(2).padStart(7)} ` +
    `${r.spikeExportKwh.toFixed(0).padStart(10)} ${r.offSpikeExportKwh.toFixed(1).padStart(14)}  ` +
    `${[r.reactionMeanS, r.reactionP95S, r.reactionMaxS].map((x) => x.toFixed(1)).join(" / ").padStart(20)} ${r.meanReportAgeS.toFixed(1).padStart(6)} ${String(r.reserveViolations).padStart(5)} ${r.maxDepthBelowReservePct.toFixed(3).padStart(6)}  ${r.triggers}`,
  );
}
console.log(`\nWrote ${path.join(OUT, "edge-eval.csv")} and edge-timeseries.csv`);
