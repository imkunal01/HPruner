// popup/popup.js - HPruner Minimalist Dashboard Controller
document.addEventListener('DOMContentLoaded', async () => {
  const statRendered = document.getElementById('stat-rendered');
  const statTotal = document.getElementById('stat-total');
  const statRam = document.getElementById('stat-ram');
  const statFps = document.getElementById('stat-fps');
  const statEngineState = document.getElementById('stat-engine-state');
  const prunedPct = document.getElementById('pruned-pct');
  const progressBar = document.getElementById('stat-progress-bar');
  const statusPill = document.getElementById('global-status-pill');
  const modeDescHint = document.getElementById('mode-desc-hint');

  const segmentButtons = document.querySelectorAll('.segment-btn');
  const chkStreaming = document.getElementById('chk-streaming');
  const chkHud = document.getElementById('chk-hud');
  const chkScrollFix = document.getElementById('chk-scroll-fix');

  const btnOpenSearch = document.getElementById('btn-open-search');
  const btnExportMd = document.getElementById('btn-export-md');
  const btnOpenDemo = document.getElementById('btn-open-demo');
  const btnRestoreAll = document.getElementById('btn-restore-all');

  const MODE_HINTS = {
    progressive: 'Slow progressive hydration • Zero lag',
    balanced: '550px overscan buffer • Fluid scrolling',
    ultra: '250px aggressive buffer • Max memory cut',
    eco: 'CSS Hardware containment • Native skip',
    off: 'Pass-through • Full DOM rendering'
  };

  let activeTabId = null;
  let currentSettings = {
    enabled: true,
    mode: 'progressive',
    safeStreamingGuard: true,
    showHud: true,
    autoScrollFix: true
  };

  // Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    activeTabId = tab.id;
  }

  // Load stored settings
  const storage = await chrome.storage.local.get('hpruner_settings');
  if (storage.hpruner_settings) {
    currentSettings = Object.assign(currentSettings, storage.hpruner_settings);
    applySettingsToUI(currentSettings);
  }

  // Query live stats from active tab
  async function fetchLiveStats() {
    if (!activeTabId) return;

    try {
      chrome.tabs.sendMessage(activeTabId, { type: 'GET_STATS' }, (response) => {
        if (chrome.runtime.lastError || !response || !response.stats) {
          renderFallbackStats();
          return;
        }

        renderStats(response.stats);
        if (response.options) {
          currentSettings = Object.assign(currentSettings, response.options);
          applySettingsToUI(currentSettings);
        }
      });
    } catch (e) {
      renderFallbackStats();
    }
  }

  function renderStats(stats) {
    const total = stats.totalTurns || 0;
    const rendered = stats.renderedTurns || 0;
    const pruned = stats.prunedTurns || 0;
    const fps = stats.fps || 60;
    const ram = stats.estimatedMemorySavedMB || '0.0';

    statRendered.textContent = rendered;
    statTotal.textContent = total;
    statRam.textContent = `${ram} MB`;
    statFps.textContent = `${fps} FPS`;

    if (total > 0) {
      const pct = Math.round((pruned / total) * 100);
      prunedPct.textContent = `${pct}% PRUNED`;
      progressBar.style.width = `${pct}%`;
      statEngineState.textContent = (stats.mode === 'progressive') ? 'STAGGERED' : 'OPTIMIZED';
    } else {
      prunedPct.textContent = `0% PRUNED`;
      progressBar.style.width = `0%`;
      statEngineState.textContent = 'READY';
    }

    if (fps >= 55) {
      statFps.style.color = 'var(--emerald)';
    } else if (fps >= 40) {
      statFps.style.color = 'var(--amber)';
    } else {
      statFps.style.color = 'var(--red)';
    }

    const isActive = stats.enabled && stats.mode !== 'off';
    statusPill.className = `header-status ${isActive ? '' : 'inactive'}`;
    statusPill.querySelector('.status-label').textContent = isActive ? 'ACTIVE' : 'OFF';
  }

  function renderFallbackStats() {
    statRendered.textContent = '-';
    statTotal.textContent = '-';
    statRam.textContent = '0.0 MB';
    statFps.textContent = '60 FPS';
    statEngineState.textContent = 'STANDBY';
    prunedPct.textContent = '0% PRUNED';
    progressBar.style.width = '0%';
  }

  function applySettingsToUI(settings) {
    segmentButtons.forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-mode') === settings.mode);
    });

    if (modeDescHint) {
      modeDescHint.textContent = MODE_HINTS[settings.mode] || MODE_HINTS.progressive;
    }

    chkStreaming.checked = Boolean(settings.safeStreamingGuard);
    chkHud.checked = Boolean(settings.showHud);
    chkScrollFix.checked = Boolean(settings.autoScrollFix);
  }

  async function updateOptions(optionsToMerge) {
    currentSettings = Object.assign(currentSettings, optionsToMerge);
    await chrome.storage.local.set({ hpruner_settings: currentSettings });

    if (activeTabId) {
      chrome.tabs.sendMessage(activeTabId, {
        type: 'UPDATE_OPTIONS',
        options: currentSettings
      }, (resp) => {
        if (resp && resp.stats) {
          renderStats(resp.stats);
        }
      });
    }
  }

  // Segment Buttons Click
  segmentButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-mode');
      const enabled = (mode !== 'off');
      updateOptions({ mode, enabled });
      applySettingsToUI(currentSettings);
    });
  });

  // Safeguard Toggles
  chkStreaming.addEventListener('change', () => {
    updateOptions({ safeStreamingGuard: chkStreaming.checked });
  });

  chkHud.addEventListener('change', () => {
    updateOptions({ showHud: chkHud.checked });
  });

  chkScrollFix.addEventListener('change', () => {
    updateOptions({ autoScrollFix: chkScrollFix.checked });
  });

  // Action Triggers
  btnOpenSearch.addEventListener('click', () => {
    if (activeTabId) {
      chrome.tabs.sendMessage(activeTabId, { type: 'TOGGLE_HPRUNER_SEARCH' });
      window.close();
    }
  });

  btnExportMd.addEventListener('click', () => {
    if (!activeTabId) return;

    chrome.tabs.sendMessage(activeTabId, { type: 'EXPORT_THREAD', format: 'markdown' }, (resp) => {
      if (resp && resp.data) {
        const blob = new Blob([resp.data], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `chatgpt-export-${Date.now()}.md`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        alert('No conversation thread data found on active tab.');
      }
    });
  });

  btnOpenDemo.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('demo/index.html') });
  });

  btnRestoreAll.addEventListener('click', (e) => {
    e.preventDefault();
    if (activeTabId) {
      chrome.tabs.sendMessage(activeTabId, { type: 'RESTORE_ALL' }, () => {
        updateOptions({ mode: 'off', enabled: false });
        applySettingsToUI(currentSettings);
        fetchLiveStats();
      });
    }
  });

  fetchLiveStats();
  const pollInterval = setInterval(fetchLiveStats, 1000);
  window.addEventListener('unload', () => clearInterval(pollInterval));
});
