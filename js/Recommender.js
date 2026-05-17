// js/recommender.js
// All recommendation logic — takes prefs and components, returns recommended IDs per type.

// ── CPU:GPU ratio by use-case slider (0=productivity, 50=gaming, 100=3D render)
// ratio = fraction of cpu+gpu budget that goes to GPU
// productivity: 1:0.5  → GPU gets 0.5/1.5 = 33%
// gaming:       1:2.2  → GPU gets 2.2/3.2 = 69%
// 3D rendering: 1:3    → GPU gets 3/4     = 75%
function getGpuBudgetFraction(sliderVal, resolution) {
  // Interpolate ratio across the 0–100 range (two segments)
  let gpuRatio;
  if (sliderVal <= 50) {
    // productivity (0) → gaming (50)
    const t = sliderVal / 50;
    gpuRatio = lerp(0.5, 2.2, t);   // cpu ratio always 1
  } else {
    // gaming (50) → 3D rendering (100)
    const t = (sliderVal - 50) / 50;
    gpuRatio = lerp(2.2, 3.0, t);
  }

  // Resolution boost: 1440p pushes more budget to GPU
  // Effect is stronger for gaming (middle), weaker at extremes
  const gamingWeight = gaussianPeak(sliderVal, 50, 30); // peaks at gaming
  const resBoost = resolution === 1440 ? 0.25 * gamingWeight : 0;
  gpuRatio += resBoost;

  // GPU fraction of cpu+gpu total
  return gpuRatio / (1 + gpuRatio);
}

function lerp(a, b, t) { return a + (b - a) * t; }

// Bell curve centered at `center` with spread `sigma`, max 1
function gaussianPeak(x, center, sigma) {
  return Math.exp(-0.5 * Math.pow((x - center) / sigma, 2));
}

// ── Budget allocation per component type ──────────────────────────────
// Returns target prices for each component given total budget.
// Case, storage, mobo, RAM are % of budget + fixed offset.
// Remaining goes to CPU+GPU.
function allocateBudget(budget, sliderVal, resolution) {
  const caseTgt     = budget * 0.04 + 30;
  const storageTgt  = budget * 0.07 + 10;
  const moboTgt     = budget * 0.07 + 10;
  const ramTgt      = budget * 0.10 + 10;

  // Average of 3 closest options for these — we'll subtract their average cost
  // For now use the target prices to estimate total fixed spend
  const fixedEstimate = caseTgt + storageTgt + moboTgt + ramTgt;
  const cpuGpuBudget  = Math.max(0, budget - fixedEstimate);

  const gpuFrac  = getGpuBudgetFraction(sliderVal, resolution);
  const gpuTgt   = cpuGpuBudget * gpuFrac;
  const cpuTgt   = cpuGpuBudget * (1 - gpuFrac);

  return { cpuTgt, gpuTgt, caseTgt, storageTgt, moboTgt, ramTgt, cpuGpuBudget };
}

// ── Recommender ───────────────────────────────────────────────────────
// Returns { cpu, gpu, psu, motherboard, ram, storage, case }
// Each value is: { recommended: [item,...], label: string }
// cpu and gpu are single best item; others are arrays of up to 3.

function getRecommendations(prefs, components) {
  const { budget, sliderVal, resolution } = prefs;
  const alloc = allocateBudget(budget, sliderVal, resolution);

  // CPU — single closest to target
  const cpu = closestByPrice(components.cpus, alloc.cpuTgt, 1)[0] || null;

  // GPU — single closest to target (skip if noGpu)
  const gpu = closestByPrice(components.gpus, alloc.gpuTgt, 1)[0] || null;

  // PSU — target = cpu.power + gpu.power + 50W overhead, rounded up to common wattage
  // Pick closest wattage; if multiple share it, return all of them
  const cpuPwr = cpu ? cpu.power : 0;
  const gpuPwr = gpu ? gpu.power : 0;
  const psuTarget = cpuPwr + gpuPwr + 50;
  const psu = recommendPsu(components.psus, psuTarget);

  // Motherboard — 3 closest to target
  const motherboard = closestByPrice(components.motherboards, alloc.moboTgt, 3);

  // RAM — 3 closest to target
  const ram = closestByPrice(components.rams, alloc.ramTgt, 3);

  // Storage — 3 closest to target
  const storage = closestByPrice(components.storage, alloc.storageTgt, 3);

  // Case — 3 closest to target
  const kase = closestByPrice(components.cases, alloc.caseTgt, 3);

  return {
    cpu:         { recommended: cpu ? [cpu] : [],  targetPrice: alloc.cpuTgt },
    gpu:         { recommended: gpu ? [gpu] : [],  targetPrice: alloc.gpuTgt },
    psu:         { recommended: psu,               targetPrice: psuTarget, isPsuWattage: true },
    motherboard: { recommended: motherboard,       targetPrice: alloc.moboTgt },
    ram:         { recommended: ram,               targetPrice: alloc.ramTgt },
    storage:     { recommended: storage,           targetPrice: alloc.storageTgt },
    case:        { recommended: kase,              targetPrice: alloc.caseTgt },
  };
}

// Return n items with price closest to target
function closestByPrice(items, target, n) {
  return [...items]
    .sort((a, b) => Math.abs(a.price - target) - Math.abs(b.price - target))
    .slice(0, n);
}

// PSU: find the wattage level that best covers the target,
// then return all PSUs at that wattage level
function recommendPsu(psus, targetWatts) {
  // Find minimum wattage that covers the target; if none, pick highest
  const covering = psus.filter(p => p.wattage >= targetWatts);
  if (covering.length === 0) {
    // All are too weak — pick closest
    return closestByPrice(psus.sort((a,b) => b.wattage - a.wattage), targetWatts, 1);
  }
  // Among covering PSUs, pick the one with smallest wattage (least overkill)
  const minWattage = Math.min(...covering.map(p => p.wattage));
  return psus.filter(p => p.wattage === minWattage);
}

// ── Label helpers ─────────────────────────────────────────────────────
function getUseCaseLabel(val) {
  if (val < 15)  return 'Productivity';
  if (val < 35)  return 'Mostly Productivity';
  if (val < 55)  return 'Balanced — productivity & gaming';
  if (val < 72)  return 'Gaming-focused';
  if (val < 88)  return 'Gaming & 3D';
  if (val < 96)  return '3D / Creative';
  return '3D Rendering / Visual FX';
}