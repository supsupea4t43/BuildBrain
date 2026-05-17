// js/compatibility.js
// Returns an array of issue strings. Empty = fully compatible.

function checkCompatibility(item, type, build, components) {
  const issues = [];

  const cpu  = build.cpuId  != null ? components.cpus.find(c => c.id === build.cpuId)  : null;
  const gpu  = build.gpuId  != null ? components.gpus.find(g => g.id === build.gpuId)  : null;
  const psu  = build.psuId  != null ? components.psus.find(p => p.id === build.psuId)  : null;
  const mobo = build.motherboardId != null ? components.motherboards.find(m => m.id === build.motherboardId) : null;
  const ram  = build.ramId  != null ? components.rams.find(r => r.id === build.ramId)  : null;
  const kase = build.caseId != null ? components.cases.find(c => c.id === build.caseId): null;

  switch (type) {

    case 'cpu':
      // If mobo already selected, check socket
      if (mobo && item.socket !== mobo.socket)
        issues.push(`Socket ${item.socket} ≠ mobo ${mobo.socket}`);
      // If PSU selected, check TDP
      if (psu) {
        const gpuPwr = gpu ? gpu.power : 0;
        if (item.power + gpuPwr + 50 > psu.wattage)
          issues.push(`PSU ${psu.wattage}W too low (need ~${item.power + gpuPwr + 50}W)`);
      }
      break;

    case 'gpu':
      // If case selected, check GPU length
      if (kase && item.length_mm && item.length_mm > kase.max_gpu_length_mm)
        issues.push(`GPU ${item.length_mm}mm > case max ${kase.max_gpu_length_mm}mm`);
      // If PSU selected, check combined TDP
      if (psu) {
        const cpuPwr = cpu ? cpu.power : 0;
        if (cpuPwr + item.power + 50 > psu.wattage)
          issues.push(`PSU ${psu.wattage}W too low (need ~${cpuPwr + item.power + 50}W)`);
      }
      break;

    case 'psu':
      // Check wattage covers cpu + gpu + overhead
      const cpuPwr = cpu ? cpu.power : 0;
      const gpuPwr = gpu ? gpu.power : 0;
      const needed = cpuPwr + gpuPwr + 50;
      if (item.wattage < needed)
        issues.push(`Only ${item.wattage}W — need ~${needed}W`);
      break;

    case 'motherboard':
      // Socket must match CPU
      if (cpu && item.socket !== cpu.socket)
        issues.push(`Socket ${item.socket} ≠ CPU ${cpu.socket}`);
      // VRM must handle CPU TDP
      if (cpu && item.vrm_max_watts && cpu.power > item.vrm_max_watts)
        issues.push(`VRM max ${item.vrm_max_watts}W < CPU ${cpu.power}W`);
      // Size must fit case
      if (kase && item.size > kase.motherboard_size)
        issues.push(`Mobo size ${item.size} > case supports ${kase.motherboard_size}`);
      break;

    case 'ram':
      // DDR type must match CPU and mobo
      if (cpu && item.ddr !== cpu.memory_type)
        issues.push(`${item.ddr} ≠ CPU needs ${cpu.memory_type}`);
      if (mobo && item.ddr !== mobo.ram_type)
        issues.push(`${item.ddr} ≠ mobo needs ${mobo.ram_type}`);
      break;

    case 'storage':
      // If type is M.2, mobo needs M.2 slots
      if (mobo && item.type === 'M.2' && mobo.m2_slots === 0)
        issues.push('Motherboard has no M.2 slots');
      if (mobo && item.type === 'SATA' && mobo.sata_ports === 0)
        issues.push('Motherboard has no SATA ports');
      break;

    case 'case':
      // Must fit motherboard size
      if (mobo && mobo.size > item.motherboard_size)
        issues.push(`Mobo size ${mobo.size} > case max ${item.motherboard_size}`);
      // Must fit GPU length
      if (gpu && gpu.length_mm && item.max_gpu_length_mm && gpu.length_mm > item.max_gpu_length_mm)
        issues.push(`GPU ${gpu.length_mm}mm > case max ${item.max_gpu_length_mm}mm`);
      break;
  }

  return issues;
}

// Check if a specific build slot is unlocked given current selections
function isUnlocked(type, build, noGpu) {
  const gpuReady = build.gpuId != null || noGpu;
  switch (type) {
    case 'cpu':
    case 'gpu':
      return true;
    case 'psu':
    case 'motherboard':
      return build.cpuId != null && gpuReady;
    case 'ram':
      return build.cpuId != null && build.motherboardId != null;
    case 'storage':
    case 'case':
      return build.motherboardId != null;
    default:
      return false;
  }
}