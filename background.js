// background.js - HPruner Service Worker
const DEFAULT_SETTINGS = {
  enabled: true,
  mode: 'balanced', // 'ultra', 'balanced', 'eco', 'off'
  overscanBuffer: 500, // px above and below viewport
  ghostPlaceholderType: 'spacer', // 'spacer' (full detachment with ghost height) or 'contained' (CSS content-visibility)
  safeStreamingGuard: true, // Never prune active streaming assistant turns
  showHud: true,
  autoScrollFix: true, // Upward scroll anchoring compensation
  customSelectors: ''
};

// Initialize settings on install
chrome.runtime.onInstalled.addListener(async (details) => {
  const existing = await chrome.storage.local.get('hpruner_settings');
  if (!existing.hpruner_settings) {
    await chrome.storage.local.set({ hpruner_settings: DEFAULT_SETTINGS });
  }
  console.log('[HPruner] Service worker initialized. Reason:', details.reason);
});

// Update extension badge based on stats from active tab
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'HPRUNER_STATS_UPDATE') {
    if (sender.tab && sender.tab.id) {
      const tabId = sender.tab.id;
      const { totalTurns, renderedTurns, enabled } = message.stats;
      
      if (!enabled) {
        chrome.action.setBadgeText({ tabId, text: 'OFF' });
        chrome.action.setBadgeBackgroundColor({ tabId, color: '#6b7280' });
      } else if (totalTurns > 0) {
        const prunedRatio = Math.round(((totalTurns - renderedTurns) / totalTurns) * 100);
        const badgeText = prunedRatio > 0 ? `${prunedRatio}%` : `${renderedTurns}`;
        chrome.action.setBadgeText({ tabId, text: badgeText });
        chrome.action.setBadgeBackgroundColor({ tabId, color: '#10b981' });
      } else {
        chrome.action.setBadgeText({ tabId, text: '' });
      }
    }
    sendResponse({ received: true });
    return true;
  }

  if (message.type === 'OPEN_DEMO_PAGE') {
    chrome.tabs.create({ url: chrome.runtime.getURL('demo/index.html') });
    sendResponse({ opened: true });
    return true;
  }
});

// Relay keyboard commands to active tab
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-search') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_HPRUNER_SEARCH' });
    }
  }
});
