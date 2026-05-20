// js/Recommender.js
// All recommendation logic — takes prefs and components, returns recommended IDs per type.

// ── Linear GPU ratio ───────────────────────────────────────────────────
// Slider 0–100 maps linearly: cpu:gpu ratio goes from 1:0.2 → 1:4
// Visual markers on the bar (no zone logic):
//   0%  = CPU Render   (ratio 1:0.2  → gpu fraction 16.7%)
//   25% = Productivity (ratio ~1:1.15 → gpu fraction ~53%)
//   75% = Gaming       (ratio ~1:2.9  → gpu fraction ~74%)
//   100%= 3D Render    (ratio 1:4    → gpu fraction 80.0%)

const GPU_RATIO_START = 0.2;
const GPU_RATIO_END   = 4.0;

function getGpuBudgetFraction(sliderVal, resolution) {
  const t      = sliderVal / 100;
  let gpuRatio = lerp(GPU_RATIO_START, GPU_RATIO_END, t);

  // Resolution boost: 1440p nudges more budget toward GPU, peaks mid-slider
  const resBoost = resolution === 1440 ? 0.3 * gaussianPeak(sliderVal, 50, 28) : 0;
  gpuRatio += resBoost;

  return gpuRatio / (1 + gpuRatio);
}

function lerp(a, b, t) { return a + (b - a) * t; }

function gaussianPeak(x, center, sigma) {
  return Math.exp(-0.5 * Math.pow((x - center) / sigma, 2));
}

// ── Budget allocation ──────────────────────────────────────────────────
function allocateBudget(budget, sliderVal, resolution) {
  const caseTgt     = budget * 0.04 + 30;
  const storageTgt  = budget * 0.07 + 10;
  const moboTgt     = budget * 0.07 + 10;
  const ramTgt      = budget * 0.10 + 10;

  const fixedEstimate = caseTgt + storageTgt + moboTgt + ramTgt;
  const cpuGpuBudget  = Math.max(0, budget - fixedEstimate);

  const gpuFrac = getGpuBudgetFraction(sliderVal, resolution);
  const gpuTgt  = cpuGpuBudget * gpuFrac;
  const cpuTgt  = cpuGpuBudget * (1 - gpuFrac);

  return { cpuTgt, gpuTgt, caseTgt, storageTgt, moboTgt, ramTgt, cpuGpuBudget };
}

// ── Recommender ───────────────────────────────────────────────────────
function getRecommendations(prefs, components) {
  const { budget, sliderVal, resolution } = prefs;
  const alloc = allocateBudget(budget, sliderVal, resolution);

  const cpu = closestByPrice(components.cpus, alloc.cpuTgt, 1)[0] || null;
  const gpu = closestByPrice(components.gpus, alloc.gpuTgt, 1)[0] || null;

  const cpuPwr   = cpu ? cpu.power : 0;
  const gpuPwr   = gpu ? gpu.power : 0;
  const psuTarget = Math.ceil((cpuPwr + gpuPwr + 130) * 1.25);
  const psu = recommendPsu(components.psus, psuTarget);

  const motherboard = closestByPrice(components.motherboards, alloc.moboTgt, 3);
  const ram         = closestByPrice(components.rams,         alloc.ramTgt,  3);
  const storage     = closestByPrice(components.storage,      alloc.storageTgt, 3);
  const kase        = closestByPrice(components.cases,        alloc.caseTgt, 3);

  return {
    cpu:         { recommended: cpu ? [cpu] : [], targetPrice: alloc.cpuTgt },
    gpu:         { recommended: gpu ? [gpu] : [], targetPrice: alloc.gpuTgt },
    psu:         { recommended: psu,              targetPrice: psuTarget, isPsuWattage: true },
    motherboard: { recommended: motherboard,      targetPrice: alloc.moboTgt },
    ram:         { recommended: ram,              targetPrice: alloc.ramTgt },
    storage:     { recommended: storage,          targetPrice: alloc.storageTgt },
    case:        { recommended: kase,             targetPrice: alloc.caseTgt },
  };
}

function closestByPrice(items, target, n) {
  return [...items]
    .sort((a, b) => Math.abs(a.price - target) - Math.abs(b.price - target))
    .slice(0, n);
}

function recommendPsu(psus, targetWatts) {
  const covering = psus.filter(p => p.wattage >= targetWatts);
  if (covering.length === 0)
    return closestByPrice([...psus].sort((a,b) => b.wattage - a.wattage), targetWatts, 1);
  const minWattage = Math.min(...covering.map(p => p.wattage));
  return psus.filter(p => p.wattage === minWattage);
}

// ── Labels ────────────────────────────────────────────────────────────
function getUseCaseLabel(val) {
  if (val < 12)  return 'CPU Rendering';
  if (val < 25)  return 'CPU-heavy / Productivity';
  if (val < 40)  return 'Productivity';
  if (val < 60)  return 'Balanced — productivity & gaming';
  if (val < 75)  return 'Gaming-focused';
  if (val < 88)  return 'Gaming & 3D';
  return '3D Rendering';
}