// js/app.js

// ── State ──────────────────────────────────────────────────────────
let components = {};
const build = {
  cpuId: null, gpuId: null, psuId: null,
  motherboardId: null, ramId: null,
  storage: [],   // array of { slotType, itemId } — multiple drives supported
  caseId: null
};
let noGpu = false;

// Preferences set in onboarding
const prefs = { sliderVal: 50, resolution: 1080, budget: 1000 };
let recommendations = {}; // populated after onboarding

// Storage picker state
let activeStorageSlot = null; // { type: 'M.2'|'SATA'|'PCIe', index: number }

const TYPE_MAP = {
  cpu:         { key: 'cpuId',          data: 'cpus' },
  gpu:         { key: 'gpuId',          data: 'gpus' },
  psu:         { key: 'psuId',          data: 'psus' },
  motherboard: { key: 'motherboardId',  data: 'motherboards' },
  ram:         { key: 'ramId',          data: 'rams' },
  case:        { key: 'caseId',         data: 'cases' },
};

const ICONS = { cpu:'⬡', gpu:'▣', psu:'⚡', motherboard:'◫', ram:'▤', storage:'◉', case:'▭' };

let currentType  = null;
let panelOpen    = false;
let panelPeeking = false;
let hoverTimer   = null;
const HOVER_DELAY = 800;

// ── DOM refs ────────────────────────────────────────────────────────
const listPanel     = document.getElementById('list-panel');
const detailPanel   = document.getElementById('detail-panel');
const backdrop      = document.getElementById('panel-backdrop');
const componentList = document.getElementById('component-list');
const panelTitle    = document.getElementById('panel-title');
const noGpuBtn      = document.getElementById('no-gpu-btn');
const storagePicker = document.getElementById('storage-picker');

// ── Init ─────────────────────────────────────────────────────────────
async function init() {
  components = await loadComponents();
  setupOnboarding();
}

function startBuilder() {
  document.getElementById('onboarding').classList.add('hidden');
  document.getElementById('builder').classList.remove('hidden');

  recommendations = getRecommendations(prefs, components);

  setupButtons();
  setupBackdrop();
  setupNoGpu();
  setupPeekClick();

  document.getElementById('close-panel').addEventListener('click', closePanel);
  document.getElementById('close-detail').addEventListener('click', closeDetail);
  document.getElementById('close-storage-picker').addEventListener('click', closeStoragePicker);
  document.getElementById('finalize-btn').addEventListener('click', openFinalizeModal);
  document.getElementById('finalize-close').addEventListener('click', closeFinalizeModal);
  document.getElementById('finalize-backdrop').addEventListener('click', closeFinalizeModal);
  document.getElementById('finalize-copy-btn').addEventListener('click', copyBuildToClipboard);
  document.getElementById('finalize-btn').addEventListener('click', openFinalizeModal);
  document.getElementById('finalize-close').addEventListener('click', closeFinalizeModal);
  document.getElementById('finalize-backdrop').addEventListener('click', closeFinalizeModal);
  document.getElementById('finalize-copy-btn').addEventListener('click', copyBuildToClipboard);

  listPanel.querySelector('.panel-handle').addEventListener('click', () => {
    if (panelOpen) peekPanel();
    else if (panelPeeking) unpeekPanel();
  });
}

// ── Onboarding ────────────────────────────────────────────────────────
function setupOnboarding() {
  let currentSlide = 0;
  const slides  = ['slide-usecase', 'slide-res', 'slide-budget'];
  const dots    = document.querySelectorAll('.ob-dot');

  function goTo(i) {
    document.getElementById(slides[currentSlide]).classList.add('hidden');
    currentSlide = i;
    document.getElementById(slides[currentSlide]).classList.remove('hidden');
    dots.forEach((d, idx) => d.classList.toggle('active', idx === currentSlide));
  }

  // Slide 1 — use-case slider
  const usecaseSlider = document.getElementById('usecase-slider');
  const sliderFill    = document.getElementById('slider-fill');
  const usecaseDesc   = document.getElementById('usecase-desc');

  function updateSlider() {
    const val = parseInt(usecaseSlider.value);
    prefs.sliderVal = val;
    const pct = val + '%';
    sliderFill.style.width = pct;
    usecaseSlider.style.setProperty('--fill', pct);
    usecaseDesc.textContent = getUseCaseLabel(val);
  }
  usecaseSlider.addEventListener('input', updateSlider);
  updateSlider();

  document.getElementById('next-usecase').addEventListener('click', () => goTo(1));

  // Slide 2 — resolution
  let selectedRes = 1080;
  document.querySelectorAll('.ob-res-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ob-res-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedRes = parseInt(btn.dataset.res);
      prefs.resolution = selectedRes;
    });
  });
  document.getElementById('next-res').addEventListener('click', () => goTo(2));

  // Slide 3 — budget
  const budgetSlider  = document.getElementById('budget-slider');
  const budgetDisplay = document.getElementById('budget-display');
  const budgetFill    = document.getElementById('budget-slider-fill');

  function updateBudgetSlider() {
    prefs.budget = parseInt(budgetSlider.value);
    budgetDisplay.textContent = prefs.budget.toLocaleString();
    const pct = ((prefs.budget - 300) / (5000 - 300) * 100) + '%';
    budgetFill.style.width = pct;
  }

  budgetSlider.addEventListener('input', updateBudgetSlider);
  updateBudgetSlider();

  document.getElementById('start-build').addEventListener('click', () => {
    startBuilder();
  });

  // Dot navigation
  dots.forEach((dot, i) => dot.addEventListener('click', () => goTo(i)));
}

// ── No-GPU toggle ─────────────────────────────────────────────────────
function cpuHasIgpu() {
  if (build.cpuId == null) return false;
  const cpu = components.cpus.find(c => c.id === build.cpuId);
  return cpu && cpu.integrated_graphics === true;
}

function updateNoGpuBtn() {
  const allowed = cpuHasIgpu();
  noGpuBtn.classList.toggle('disabled', !allowed);
  noGpuBtn.title = allowed
    ? 'Skip GPU — use CPU integrated graphics'
    : 'Selected CPU has no integrated graphics';

  if (!allowed && noGpu) {
    noGpu = false;
    noGpuBtn.classList.remove('active');
    const gpuBtn   = document.querySelector('[data-type="gpu"]');
    const gpuLabel = document.getElementById('selected-gpu');
    gpuBtn.classList.remove('no-gpu-active');
    gpuLabel.textContent = 'Not selected';
    updateLocks();
    updateSummary();
  }
}

function setupNoGpu() {
  noGpuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!cpuHasIgpu()) return;

    noGpu = !noGpu;
    noGpuBtn.classList.toggle('active', noGpu);

    const gpuBtn   = document.querySelector('[data-type="gpu"]');
    const gpuLabel = document.getElementById('selected-gpu');

    if (noGpu) {
      build.gpuId = null;
      gpuBtn.classList.remove('selected', 'incompat-selected');
      gpuBtn.classList.add('no-gpu-active');
      gpuLabel.textContent = 'Skipped (iGPU)';
    } else {
      gpuBtn.classList.remove('no-gpu-active');
      gpuLabel.textContent = 'Not selected';
    }

    updateLocks();
    updateSummary();
    updateFpsDisplay();
  });
}

// ── Button setup ─────────────────────────────────────────────────────
function setupButtons() {
  document.querySelectorAll('.comp-btn').forEach(btn => {
    const type = btn.dataset.type;

    btn.addEventListener('click', () => {
      if (!isUnlocked(type, build, noGpu)) return;
      clearHoverTimer();
      if (type === 'storage') {
        openStoragePicker();
      } else {
        openPanel(type);
      }
    });

    btn.addEventListener('mouseenter', () => {
      if (!isUnlocked(type, build, noGpu)) return;
      const key = TYPE_MAP[type].key;
      const selectedId = build[key];
      if (selectedId == null) return;
      hoverTimer = setTimeout(() => {
        const item = components[TYPE_MAP[type].data].find(i => i.id === selectedId);
        if (item) openDetailFromButton(item, type);
      }, HOVER_DELAY);
    });

    btn.addEventListener('mouseleave', clearHoverTimer);
  });
}

function clearHoverTimer() {
  if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
}

function setupBackdrop() {
  backdrop.addEventListener('click', () => {
    if (storagePicker.classList.contains('open')) { closeStoragePicker(); return; }
    if (detailPanel.classList.contains('open')) { closeDetail(); return; }
    if (panelOpen) peekPanel();
  });
}

function setupPeekClick() {
  listPanel.addEventListener('click', (e) => {
    if (!panelPeeking) return;
    const list = document.getElementById('component-list');
    if (list && list.contains(e.target)) return;
    unpeekPanel();
  });
}

// ── Panel open/close ──────────────────────────────────────────────────
function openPanel(type) {
  currentType = type;
  panelTitle.textContent = `Select ${type.charAt(0).toUpperCase() + type.slice(1)}`;
  renderList(type);
  listPanel.classList.add('open');
  listPanel.classList.remove('peek');
  backdrop.classList.add('visible');
  panelOpen = true; panelPeeking = false;
}

function peekPanel() {
  listPanel.classList.remove('open');
  listPanel.classList.add('peek');
  panelPeeking = true; panelOpen = false;
  backdrop.classList.remove('visible');
  closeDetail();
}

function unpeekPanel() {
  listPanel.classList.add('open');
  listPanel.classList.remove('peek');
  backdrop.classList.add('visible');
  panelOpen = true; panelPeeking = false;
}

function closePanel() {
  listPanel.classList.remove('open', 'peek');
  backdrop.classList.remove('visible');
  panelOpen = false; panelPeeking = false;
  closeDetail();
}

// ── Detail panel ──────────────────────────────────────────────────────
function openDetail(item, type) {
  const issues = checkCompatibility(item, type, build, components);
  document.getElementById('detail-content').innerHTML = renderDetailHTML(item, type, issues, true);
  detailPanel.classList.add('open');

  const btn = document.getElementById('detail-select-btn');
  if (btn) {
    // Clone to remove any previously attached listeners
    const fresh = btn.cloneNode(true);
    btn.replaceWith(fresh);
    fresh.addEventListener('click', () => {
      selectComponent(item, type, issues);
      closePanel();
    });
  }
}

function openDetailFromButton(item, type) {
  const issues = checkCompatibility(item, type, build, components);
  document.getElementById('detail-content').innerHTML = renderDetailHTML(item, type, issues, false);
  detailPanel.classList.add('open');
  backdrop.classList.add('visible');
}

function closeDetail() {
  detailPanel.classList.remove('open');
  if (!panelOpen) backdrop.classList.remove('visible');
}

// ── Storage slot picker ───────────────────────────────────────────────
function openStoragePicker() {
  renderStorageSlots();
  storagePicker.classList.add('open');
  backdrop.classList.add('visible');
}

function closeStoragePicker() {
  storagePicker.classList.remove('open');
  if (!panelOpen) backdrop.classList.remove('visible');
}

function getMotherboard() {
  if (build.motherboardId == null) return null;
  return components.motherboards.find(m => m.id === build.motherboardId);
}

function renderStorageSlots() {
  const mobo = getMotherboard();
  const slotsEl = document.getElementById('storage-slots');
  slotsEl.innerHTML = '';

  // Build the full slot list from motherboard specs
  const slotDefs = [];
  if (mobo) {
    for (let i = 0; i < (mobo.m2_slots || 0); i++)
      slotDefs.push({ type: 'M.2', index: i, label: `M.2 Slot ${i + 1}`, speed: 'NVMe / SATA' });
    for (let i = 0; i < (mobo.sata_ports || 0); i++)
      slotDefs.push({ type: 'SATA', index: i, label: `SATA Port ${i + 1}`, speed: 'Up to 600 MB/s' });
  } else {
    // No mobo yet — show generic slots so user can still explore
    for (let i = 0; i < 2; i++)
      slotDefs.push({ type: 'M.2', index: i, label: `M.2 Slot ${i + 1}`, speed: 'NVMe / SATA' });
    for (let i = 0; i < 4; i++)
      slotDefs.push({ type: 'SATA', index: i, label: `SATA Port ${i + 1}`, speed: 'Up to 600 MB/s' });
  }

  if (!mobo) {
    const warn = document.createElement('div');
    warn.className = 'storage-no-mobo';
    warn.textContent = '⚠ Select a motherboard first for accurate slot counts';
    slotsEl.appendChild(warn);
  }

  slotDefs.forEach(slot => {
    const filled = build.storage.find(s => s.type === slot.type && s.index === slot.index);
    const item   = filled ? components.storage.find(s => s.id === filled.itemId) : null;

    const el = document.createElement('div');
    el.className = `storage-slot ${filled ? 'filled' : 'empty'}`;

    const typeIcon = slot.type === 'M.2' ? '▤' : '◉';

    el.innerHTML = `
      <div class="slot-left">
        <span class="slot-icon">${typeIcon}</span>
        <div class="slot-info">
          <div class="slot-label">${slot.label}</div>
          <div class="slot-speed">${filled ? item.name : slot.speed}</div>
        </div>
      </div>
      <div class="slot-right">
        ${filled
          ? `<span class="slot-price">$${item.price}</span>
             <button class="slot-remove" data-type="${slot.type}" data-index="${slot.index}">✕</button>`
          : `<span class="slot-add">+ Add</span>`
        }
      </div>
    `;

    // Click anywhere on empty slot → open list filtered by type
    if (!filled) {
      el.addEventListener('click', () => {
        activeStorageSlot = { type: slot.type, index: slot.index };
        closeStoragePicker();
        openStorageList(slot.type);
      });
    }

    // Remove button
    const removeBtn = el.querySelector('.slot-remove');
    if (removeBtn) {
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        build.storage = build.storage.filter(
          s => !(s.type === slot.type && s.index === slot.index)
        );
        updateStorageButton();
        renderStorageSlots();
      });
    }

    slotsEl.appendChild(el);
  });
}

function openStorageList(filterType) {
  currentType = 'storage';
  panelTitle.textContent = `Select ${filterType} Storage`;
  renderStorageListFiltered(filterType);
  listPanel.classList.add('open');
  listPanel.classList.remove('peek');
  backdrop.classList.add('visible');
  panelOpen = true; panelPeeking = false;
}

function renderStorageListFiltered(filterType) {
  const items = (components.storage || []).filter(s => s.type === filterType);
  componentList.innerHTML = '';

  const recItems = (recommendations.storage && recommendations.storage.recommended) || [];
  const recIds   = new Set(recItems.filter(i => i.type === filterType).map(i => i.id));
  const targetPrice = recommendations.storage && recommendations.storage.targetPrice;

  const withIssues = items.map(item => ({
    item,
    issues: [], // storage has no hard compatibility issues beyond slot type
    isRec: recIds.has(item.id)
  }));

  withIssues.sort((a, b) => {
    const aScore = (a.isRec ? 1 : 0);
    const bScore = (b.isRec ? 1 : 0);
    return bScore - aScore;
  });

  if (targetPrice != null) {
    const hint = document.createElement('div');
    hint.className = 'list-hint';
    hint.textContent = `Budget target: $${Math.round(targetPrice)} · ⭐ = recommended for your build`;
    componentList.appendChild(hint);
  }

  withIssues.forEach(({ item, issues, isRec }) => {
    const card = document.createElement('div');
    card.className = `comp-card compat ${isRec ? 'recommended' : ''}`;

    const imgHTML = item.image
      ? `<img src="${item.image}" alt="${item.name}" loading="lazy">`
      : `<div class="no-img">◉</div>`;

    const storageBadge = isRec
      ? `<div class="compat-badge ok rec">⭐ Recommended</div>`
      : `<div class="compat-badge ok">✓ Compatible</div>`;

    card.innerHTML = `
      ${imgHTML}
      <div class="card-name">${item.name}</div>
      <div class="card-meta">
        <span>${item.capacity_gb}GB</span>
        <span>$${item.price}</span>
      </div>
      <div class="card-score"><span>${item.read_mbps} MB/s read</span></div>
      ${storageBadge}
      <button class="select-hover-btn">Select</button>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('select-hover-btn')) {
        e.stopPropagation();
        selectStorage(item);
        closePanel();
        return;
      }
      // Detail view for storage
      const issues = [];
      document.getElementById('detail-content').innerHTML = renderDetailHTML(item, 'storage', issues, true);
      detailPanel.classList.add('open');
      const rawBtn = document.getElementById('detail-select-btn');
      if (rawBtn) {
        const fresh = rawBtn.cloneNode(true);
        rawBtn.replaceWith(fresh);
        fresh.addEventListener('click', () => { selectStorage(item); closePanel(); });
      }
    });

    componentList.appendChild(card);
  });
}

function selectStorage(item) {
  if (!activeStorageSlot) return;
  // Remove any existing drive in this slot
  build.storage = build.storage.filter(
    s => !(s.type === activeStorageSlot.type && s.index === activeStorageSlot.index)
  );
  build.storage.push({ type: activeStorageSlot.type, index: activeStorageSlot.index, itemId: item.id });
  activeStorageSlot = null;
  updateStorageButton();
  updateSummary();
}

function updateStorageButton() {
  const label = document.getElementById('selected-storage');
  const btn   = document.querySelector('[data-type="storage"]');
  if (build.storage.length === 0) {
    if (label) label.textContent = 'Not selected';
    if (btn) btn.classList.remove('selected');
  } else {
    if (label) label.textContent = `${build.storage.length} drive${build.storage.length > 1 ? 's' : ''} selected`;
    if (btn) btn.classList.add('selected');
  }
  updateFinalizeBtn();
}

// ── Render list ───────────────────────────────────────────────────────
function renderList(type) {
  const items = components[TYPE_MAP[type].data] || [];
  componentList.innerHTML = '';

  // Get recommended IDs for this type
  const recItems = (recommendations[type] && recommendations[type].recommended) || [];
  const recIds   = new Set(recItems.map(i => i.id));
  const targetPrice = recommendations[type] && recommendations[type].targetPrice;
  const isPsuWattage = recommendations[type] && recommendations[type].isPsuWattage;

  const withIssues = items.map(item => ({
    item,
    issues: checkCompatibility(item, type, build, components),
    isRec: recIds.has(item.id)
  }));

  // Sort: recommended+compatible first, then compatible, then incompatible
  withIssues.sort((a, b) => {
    const aActualRec = a.isRec && a.issues.length === 0;
    const bActualRec = b.isRec && b.issues.length === 0;
    const aScore = (aActualRec ? 2 : 0) + (a.issues.length === 0 ? 1 : 0);
    const bScore = (bActualRec ? 2 : 0) + (b.issues.length === 0 ? 1 : 0);
    return bScore - aScore;
  });

  // Panel header hint
  if (targetPrice != null) {
    const hint = document.createElement('div');
    hint.className = 'list-hint';
    if (isPsuWattage) {
      hint.textContent = `Target: ≥${Math.round(targetPrice)}W (CPU+GPU TDP + overhead)`;
    } else {
      hint.textContent = `Budget target: $${Math.round(targetPrice)} · ⭐ = recommended for your build`;
    }
    componentList.appendChild(hint);
  }

  withIssues.forEach(({ item, issues, isRec }) => {
    const ok  = issues.length === 0;
    // Recommended only counts if also compatible
    const isActuallyRec = isRec && ok;

    const card = document.createElement('div');
    card.className = `comp-card ${ok ? 'compat' : 'incompat'} ${isActuallyRec ? 'recommended' : ''}`;

    const imgHTML = item.image
      ? `<img src="${item.image}" alt="${item.name}" loading="lazy">`
      : `<div class="no-img">${ICONS[type] || '?'}</div>`;

    const normScore = normalizeScore(item, type);
    const scoreHTML = normScore != null
      ? `<div class="card-score"><span>Score ${normScore.toFixed(1)}/100</span></div>` : '';

    const badgeHTML = isActuallyRec
      ? `<div class="compat-badge ok rec">⭐ Recommended</div>`
      : ok
        ? `<div class="compat-badge ok">✓ Compatible</div>`
        : `<div class="compat-badge fail">✗ ${issues[0]}</div>`;

    const priceStr = item.price != null ? `$${item.price}` : '—';
    const subStr   = getCardSub(item, type);
    const btnClass = ok ? 'select-hover-btn' : 'select-hover-btn incompat-select';
    const btnLabel = ok ? 'Select' : 'Select anyway';

    card.innerHTML = `
      ${imgHTML}
      <div class="card-name">${item.name}</div>
      <div class="card-meta"><span>${subStr}</span><span>${priceStr}</span></div>
      ${scoreHTML}
      ${badgeHTML}
      <button class="${btnClass}">${btnLabel}</button>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('select-hover-btn')) {
        e.stopPropagation();
        selectComponent(item, type, issues);
        closePanel();
        return;
      }
      openDetail(item, type);
    });

    componentList.appendChild(card);
  });
}

// Normalize raw scores to 0–100 for display
function normalizeScore(item, type) {
  if (item.score == null) return null;
  if (type === 'cpu') return Math.min(100, (item.score / 66000) * 100);
  if (type === 'gpu') return Math.min(100, (item.score / 39000) * 100);
  return item.score;
}

// FPS prediction model (linear regression, CS:GO max settings)
function predictFPS(gpuScore, cpuScore, vram, resolution) {
  const intercept = 4.03708;
  const coefGPU  = 0.00653152;
  const coefCPU  = 0.000426158;
  const coefVRAM = 0.0534632;
  const coefRes1 =  27.5333;
  const coefRes2 = -27.5333;
  const resCoef  = resolution === 1 ? coefRes1 : coefRes2;
  return intercept
    + coefGPU  * gpuScore
    + coefCPU  * cpuScore
    + coefVRAM * vram
    + resCoef;
}

function updateFpsDisplay() {
  const fpsWrap = document.getElementById('fps-display');
  if (!fpsWrap) return;

  const cpu = build.cpuId ? components.cpus.find(c => c.id === build.cpuId) : null;
  const gpu = build.gpuId ? components.gpus.find(g => g.id === build.gpuId) : null;

  if (!cpu || (!gpu && !noGpu)) {
    fpsWrap.innerHTML = `
      <div class="fps-hint">Select CPU & GPU to see predicted FPS</div>`;
    return;
  }

  const gpuScore = gpu ? gpu.score : 0;
  const vram     = gpu ? gpu.vram  : 0;
  const resCode  = prefs.resolution === 1080 ? 1 : 2;
  const fps      = predictFPS(gpuScore, cpu.score, vram, resCode);
  const fpsRound = Math.round(fps);

  // Colour: green ≥144, yellow ≥60, red below
  const colour = fpsRound >= 144 ? '#22c55e' : fpsRound >= 60 ? '#f59e0b' : '#ef4444';
  const tier   = fpsRound >= 144 ? 'Competitive' : fpsRound >= 60 ? 'Playable' : 'Low';

  fpsWrap.innerHTML = `
    <div class="fps-game">
      <span class="fps-game-name">Counter Strike 2</span>
      <span class="fps-preset">Max settings · ${prefs.resolution}p</span>
    </div>
    <div class="fps-number" style="color:${colour}">${fpsRound}</div>
    <div class="fps-label">FPS <span class="fps-tier" style="color:${colour}">${tier}</span></div>
  `;
}

function getCardSub(item, type) {
  switch (type) {
    case 'cpu':         return item.socket || '';
    case 'gpu':         return item.vram != null ? `${item.vram}GB VRAM` : '';
    case 'psu':         return item.wattage ? `${item.wattage}W · ${item.form_factor || 'ATX'}` : '';
    case 'motherboard': return item.socket || '';
    case 'ram':         return item.gb ? `${item.gb}GB ${item.ddr}` : '';
    case 'storage':     return item.capacity_gb ? `${item.capacity_gb}GB` : '';
    case 'case':        return item.max_gpu_length_mm ? `GPU ≤${item.max_gpu_length_mm}mm` : '';
    default:            return '';
  }
}

function getSpecRows(item, type) {
  const rows = [];
  const add = (k, v) => { if (v != null && v !== '') rows.push([k, v]); };
  switch (type) {
    case 'cpu':
      add('Socket', item.socket); add('TDP', item.power ? `${item.power}W` : null);
      add('Memory', item.memory_type);
      add('iGPU', item.integrated_graphics != null ? (item.integrated_graphics ? 'Yes' : 'No') : null);
      break;
    case 'gpu':
      add('VRAM', item.vram ? `${item.vram}GB` : null);
      add('TDP', item.power ? `${item.power}W` : null);
      add('Length', item.length_mm ? `${item.length_mm}mm` : null);
      break;
    case 'psu':
      add('Wattage', item.wattage ? `${item.wattage}W` : null);
      add('Form factor', item.form_factor || null);
      add('Type', item.type);
      add('Efficiency', item.efficiency ? ['Bronze','Gold','Platinum'][item.efficiency-1] : null);
      break;
    case 'motherboard':
      add('Socket', item.socket); add('RAM type', item.ram_type);
      add('PCIe slots', item.pcie_slots); add('M.2 slots', item.m2_slots);
      add('SATA ports', item.sata_ports);
      add('Wi-Fi', item.wifi != null ? (item.wifi ? 'Yes' : 'No') : null);
      add('Form factor', ['ITX','mATX','ATX'][item.size-1]);
      add('VRM max', item.vrm_max_watts ? `${item.vrm_max_watts}W` : null);
      break;
    case 'ram':
      add('Capacity', item.gb ? `${item.gb}GB` : null); add('Sticks', item.sticks);
      add('Type', item.ddr); add('Speed', item.speed ? `${item.speed}MHz` : null);
      add('CL', item.cl ? `CL${item.cl}` : null);
      break;
    case 'storage':
      add('Capacity', item.capacity_gb ? `${item.capacity_gb}GB` : null);
      add('Interface', item.type);
      add('Read', item.read_mbps ? `${item.read_mbps} MB/s` : null);
      add('Write', item.write_mbps ? `${item.write_mbps} MB/s` : null);
      break;
    case 'case':
      add('Max mobo size', ['ITX','mATX','ATX'][item.motherboard_size-1]);
      add('Max GPU', item.max_gpu_length_mm ? `${item.max_gpu_length_mm}mm` : null);
      add('Max cooler', item.max_cooler_height_mm ? `${item.max_cooler_height_mm}mm` : null);
      add('PSU support', item.max_psu_form_factor || null);
      break;
  }
  return rows;
}

function renderDetailHTML(item, type, issues, showSelectBtn) {
  const ok = issues.length === 0;
  const imgHTML = item.image
    ? `<img src="${item.image}" alt="${item.name}">`
    : `<div class="no-img">${ICONS[type] || '?'}</div>`;

  const normScore = normalizeScore(item, type);
  const scoreBar = normScore != null ? `
    <div class="score-bar-wrap">
      <div class="score-bar-label"><span>Performance score</span><span>${normScore.toFixed(1)}/100</span></div>
      <div class="score-bar-track"><div class="score-bar-fill" style="width:${normScore}%"></div></div>
    </div>` : '';

  const specsHTML = getSpecRows(item, type)
    .map(([k,v]) => `<div class="spec-row"><span class="spec-key">${k}</span><span class="spec-val">${v}</span></div>`)
    .join('');

  const compatHTML = ok
    ? `<div class="detail-compat ok">✓ Compatible with current build</div>`
    : `<div class="detail-compat fail">✗ ${issues.join(' · ')}</div>`;

  const selectHTML = showSelectBtn ? `
    <button class="detail-select-btn ${ok ? '' : 'incompat-btn'}" id="detail-select-btn">
      ${ok ? 'Select this component' : '⚠ Select anyway (incompatible)'}
    </button>` : '';

  const linkHTML = item.link
    ? `<a class="detail-buy-link" href="${item.link}" target="_blank" rel="noopener">🛒 View on Amazon</a>`
    : '';

  return `${imgHTML}
    <div class="detail-name">${item.name}</div>
    <div class="detail-price">$${item.price}</div>
    ${scoreBar}
    <div class="detail-specs">${specsHTML}</div>
    ${compatHTML}
    ${selectHTML}
    ${linkHTML}`;
}

// ── Select component ──────────────────────────────────────────────────
function selectComponent(item, type, issues) {
  const ok  = !issues || issues.length === 0;
  const key = TYPE_MAP[type].key;
  build[key] = item.id;

  const label = document.getElementById(`selected-${type}`);
  if (label) label.textContent = item.name;

  const btn = document.querySelector(`[data-type="${type}"]`);
  if (btn) {
    btn.classList.add('selected');
    btn.classList.toggle('incompat-selected', !ok);
  }

  updateNoGpuBtn();
  updateLocks();
  updateSummary();
  updateFpsDisplay();
  revalidateSelected();
}

// Re-check all already-selected components and highlight any that are
// now incompatible due to the latest selection changing the build state.
function revalidateSelected() {
  const typeDataMap = {
    cpu:         { data: 'cpus',         key: 'cpuId' },
    gpu:         { data: 'gpus',         key: 'gpuId' },
    psu:         { data: 'psus',         key: 'psuId' },
    motherboard: { data: 'motherboards', key: 'motherboardId' },
    ram:         { data: 'rams',         key: 'ramId' },
    storage:     null, // handled separately
    case:        { data: 'cases',        key: 'caseId' },
  };
  Object.entries(typeDataMap).forEach(([t, meta]) => {
    if (!meta) return;
    const id = build[meta.key];
    if (id == null) return; // not selected yet
    const item = components[meta.data].find(i => i.id === id);
    if (!item) return;
    const issues = checkCompatibility(item, t, build, components);
    const btn = document.querySelector(`[data-type="${t}"]`);
    if (btn && btn.classList.contains('selected')) {
      btn.classList.toggle('incompat-selected', issues.length > 0);
    }
  });
}

// ── Locks ─────────────────────────────────────────────────────────────
function updateLocks() {
  ['psu','motherboard','ram','storage','case'].forEach(type => {
    const unlocked = isUnlocked(type, build, noGpu);
    const btn   = document.getElementById(`btn-${type}`);
    const lock  = document.getElementById(`lock-${type}`);
    const label = document.getElementById(`selected-${type}`);
    if (!btn) return;
    if (unlocked) {
      btn.classList.remove('locked');
      if (lock) lock.textContent = '';
      // For storage, label is managed by updateStorageButton
      // For others, only reset if nothing selected
      if (type !== 'storage') {
        const entry = TYPE_MAP[type];
        if (entry && build[entry.key] == null && label) label.textContent = 'Not selected';
      }
    } else {
      btn.classList.add('locked');
      if (lock) lock.textContent = '🔒';
    }
  });
}

function updateSummary() {
  let totalPrice = 0;
  Object.entries(TYPE_MAP).forEach(([, { key, data }]) => {
    const id = build[key];
    if (id == null) return;
    const item = components[data].find(i => i.id === id);
    if (item) totalPrice += item.price || 0;
  });

  // Add storage drives
  build.storage.forEach(s => {
    const item = components.storage.find(i => i.id === s.itemId);
    if (item) totalPrice += item.price || 0;
  });

  const cpu = build.cpuId ? components.cpus.find(c => c.id === build.cpuId) : null;
  const gpu = build.gpuId ? components.gpus.find(g => g.id === build.gpuId) : null;
  const tdp = (cpu ? cpu.power : 0) + (gpu ? gpu.power : 0);

  document.getElementById('summary-tdp').textContent   = `${tdp}W`;
  document.getElementById('summary-price').textContent = `$${totalPrice.toLocaleString()}`;

  updateFinalizeBtn();
}

// ── Finalize ──────────────────────────────────────────────────────────
function isBuildComplete() {
  const gpuOk = build.gpuId != null || noGpu;
  return (
    build.cpuId         != null &&
    gpuOk                        &&
    build.psuId         != null &&
    build.motherboardId != null &&
    build.ramId         != null &&
    build.storage.length > 0    &&
    build.caseId        != null
  );
}

function updateFinalizeBtn() {
  const btn = document.getElementById('finalize-btn');
  if (!btn) return;
  const complete = isBuildComplete();
  btn.disabled = !complete;
  btn.classList.toggle('ready', complete);
}

function openFinalizeModal() {
  const body  = document.getElementById('finalize-body');
  const total = document.getElementById('finalize-total');

  const rows  = buildSummaryRows();
  let   grand = 0;

  body.innerHTML = rows.map(row => {
    grand += row.price;
    const compatClass = row.compat ? '' : 'finalize-row-incompat';
    return `
      <div class="finalize-row ${compatClass}">
        <div class="finalize-row-left">
          <span class="finalize-row-type">${row.type}</span>
          <span class="finalize-row-name">${row.name}</span>
          ${!row.compat ? `<span class="finalize-row-warn">⚠ Compatibility issue</span>` : ''}
        </div>
        <div class="finalize-row-right">
          <span class="finalize-row-price">$${row.price}</span>
          <a class="finalize-row-link" href="${row.link}" target="_blank" rel="noopener">View →</a>
        </div>
      </div>`;
  }).join('');

  total.innerHTML = `
    <span>Estimated total</span>
    <span class="finalize-grand">$${grand.toLocaleString()}</span>
  `;

  document.getElementById('finalize-backdrop').classList.add('visible');
  document.getElementById('finalize-modal').classList.add('open');
}

function closeFinalizeModal() {
  document.getElementById('finalize-backdrop').classList.remove('visible');
  document.getElementById('finalize-modal').classList.remove('open');
}

function buildSummaryRows() {
  const rows = [];

  const addRow = (type, item, compat = true) => {
    if (!item) return;
    rows.push({ type, name: item.name, price: item.price || 0, link: item.link || '#', compat });
  };

  const cpu  = build.cpuId ? components.cpus.find(c => c.id === build.cpuId) : null;
  const gpu  = build.gpuId ? components.gpus.find(g => g.id === build.gpuId) : null;
  const psu  = build.psuId ? components.psus.find(p => p.id === build.psuId) : null;
  const mobo = build.motherboardId ? components.motherboards.find(m => m.id === build.motherboardId) : null;
  const ram  = build.ramId ? components.rams.find(r => r.id === build.ramId) : null;
  const kase = build.caseId ? components.cases.find(c => c.id === build.caseId) : null;

  if (cpu)  addRow('CPU', cpu,  checkCompatibility(cpu,  'cpu',  build, components).length === 0);
  if (gpu)  addRow('GPU', gpu,  checkCompatibility(gpu,  'gpu',  build, components).length === 0);
  if (mobo) addRow('Motherboard', mobo, checkCompatibility(mobo, 'motherboard', build, components).length === 0);
  if (ram)  addRow('RAM', ram,  checkCompatibility(ram,  'ram',  build, components).length === 0);
  if (psu)  addRow('PSU', psu,  checkCompatibility(psu,  'psu',  build, components).length === 0);
  if (kase) addRow('Case', kase, checkCompatibility(kase, 'case', build, components).length === 0);

  build.storage.forEach((s, i) => {
    const item = components.storage.find(x => x.id === s.itemId);
    if (item) rows.push({ type: `Storage ${i + 1}`, name: item.name, price: item.price || 0, link: item.link || '#', compat: true });
  });

  return rows;
}

function copyBuildToClipboard() {
  const rows  = buildSummaryRows();
  let   grand = 0;
  const lines = rows.map(r => {
    grand += r.price;
    return `${r.type}: ${r.name} — $${r.price}\n  ${r.link}`;
  });
  lines.push('');
  lines.push(`Total estimate: $${grand.toLocaleString()}`);

  navigator.clipboard.writeText(lines.join('\n')).then(() => {
    const btn = document.getElementById('finalize-copy-btn');
    btn.textContent = '✓ Copied!';
    setTimeout(() => btn.textContent = '📋 Copy to clipboard', 2000);
  });
}

init();