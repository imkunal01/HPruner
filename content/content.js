// content/content.js - HPruner Content Script Orchestrator
(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__hpruner_injected) return;
  window.__hpruner_injected = true;

  let virtualizer = null;
  let searchOverlay = null;
  let hud = null;

  async function init() {
    // Load stored settings or defaults
    const result = await new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get('hpruner_settings', resolve);
      } else {
        resolve({});
      }
    });

    const settings = result.hpruner_settings || {
      enabled: true,
      mode: 'balanced',
      overscanBuffer: 500,
      safeStreamingGuard: true,
      showHud: true,
      autoScrollFix: true
    };

    // Instantiate core modules
    virtualizer = new window.HPrunerVirtualizer(settings);
    searchOverlay = new window.HPrunerSearchOverlay(virtualizer);
    hud = new window.HPrunerHUD(virtualizer, searchOverlay);

    if (!settings.showHud) {
      hud.setVisible(false);
    }

    // Broadcast stats to background script for badge updates
    virtualizer.onStatsChange((stats) => {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        try {
          chrome.runtime.sendMessage({
            type: 'HPRUNER_STATS_UPDATE',
            stats: stats
          });
        } catch (e) {
          // Context invalidated on extension reload
        }
      }
    });

    // Listen for extension commands & popup messages
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'GET_STATS') {
          sendResponse({ stats: virtualizer.stats, options: virtualizer.options });
          return true;
        }

        if (message.type === 'UPDATE_OPTIONS') {
          virtualizer.setOptions(message.options);
          if (message.options.showHud !== undefined) {
            hud.setVisible(message.options.showHud);
          }
          sendResponse({ success: true, stats: virtualizer.stats });
          return true;
        }

        if (message.type === 'TOGGLE_HPRUNER_SEARCH') {
          searchOverlay.toggle();
          sendResponse({ opened: searchOverlay.isOpen });
          return true;
        }

        if (message.type === 'EXPORT_THREAD') {
          const exportData = exportThreadData(message.format || 'markdown');
          sendResponse({ data: exportData });
          return true;
        }

        if (message.type === 'RESTORE_ALL') {
          virtualizer.restoreAll();
          sendResponse({ success: true });
          return true;
        }
      });
    }

    // Expose debug handle for DevTools console
    window.__HPRUNER__ = {
      virtualizer,
      searchOverlay,
      hud,
      getStats: () => virtualizer.stats,
      getTurns: () => virtualizer.turns
    };

    console.log('%c[HPruner] ⚡ Content orchestrator active. Type __HPRUNER__.getStats() to inspect.', 'color: #10b981;');
  }

  function exportThreadData(format) {
    if (!virtualizer) return '';
    const turns = virtualizer.turns || [];

    if (format === 'json') {
      const data = turns.map(t => ({
        index: t.index + 1,
        role: t.role,
        text: t.textContent || (t.element ? t.element.textContent : '')
      }));
      return JSON.stringify(data, null, 2);
    }

    // Markdown export
    let md = `# ChatGPT Conversation Export\n*Exported via HPruner on ${new Date().toLocaleString()}*\n\n---\n\n`;
    turns.forEach(t => {
      const roleName = (t.role === 'user') ? '👤 User' : '🤖 Assistant';
      const text = (t.textContent || (t.element ? t.element.textContent : '')).trim();
      md += `### ${roleName} (Turn #${t.index + 1})\n\n${text}\n\n---\n\n`;
    });
    return md;
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
