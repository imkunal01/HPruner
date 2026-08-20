// content/virtualizer.js - Production-Grade ChatGPT & Chat DOM Virtualizer
(function () {
  'use strict';

  class HPrunerVirtualizer {
    constructor(options = {}) {
      this.options = Object.assign({
        enabled: true,
        mode: 'balanced', // 'ultra' (250px), 'balanced' (550px), 'eco' (800px), 'off'
        overscanBuffer: 550,
        safeStreamingGuard: true,
        autoScrollFix: true,
        customSelectors: ''
      }, options);

      this.isInitialized = false;
      this.scrollContainer = null;
      this.turns = []; // Array of TurnRecord
      this.turnMap = new Map(); // element -> TurnRecord
      this.resizeObserver = null;
      this.mutationObserver = null;
      this.scanInterval = null;
      this.rafId = null;
      this.lastUrl = window.location.href;
      this.isScrolling = false;
      this.scrollTimeout = null;

      // Stats
      this.stats = {
        totalTurns: 0,
        renderedTurns: 0,
        prunedTurns: 0,
        estimatedMemorySavedMB: '0.0',
        fps: 60,
        enabled: this.options.enabled,
        mode: this.options.mode
      };

      this.onStatsChangeCallbacks = new Set();
      this.onIndexUpdateCallbacks = new Set();

      this.init();
    }

    init() {
      if (this.isInitialized) return;
      this.isInitialized = true;

      this.setupGlobalScrollCapture();
      this.setupResizeObserver();
      this.findScrollContainer();
      this.startObservingDOM();
      this.startFPSMeter();
      this.startRouteWatcher();
      this.startPeriodicScan();

      // Initial scan
      this.scanAndRegisterTurns();
      this.scheduleVirtualize();

      console.log('%c[HPruner] ⚡ Virtualizer engine active on ' + window.location.hostname, 'color: #10b981; font-weight: bold; font-size: 13px;');
      console.log('[HPruner] Initial turns detected:', this.turns.length, '| Mode:', this.options.mode);
    }

    // Capture-phase scroll listener catches all scroll events on the window, document, or nested divs
    setupGlobalScrollCapture() {
      this.handleScrollBound = () => this.handleScroll();
      window.addEventListener('scroll', this.handleScrollBound, { passive: true, capture: true });
      document.addEventListener('scroll', this.handleScrollBound, { passive: true, capture: true });
      window.addEventListener('resize', () => this.scheduleVirtualize(), { passive: true });
    }

    setOptions(newOptions) {
      this.options = Object.assign(this.options, newOptions);

      if (this.options.mode === 'ultra') {
        this.options.overscanBuffer = 250;
      } else if (this.options.mode === 'balanced') {
        this.options.overscanBuffer = 550;
      } else if (this.options.mode === 'eco') {
        this.options.overscanBuffer = 850;
      }

      if (!this.options.enabled || this.options.mode === 'off') {
        this.restoreAll();
      } else {
        this.findScrollContainer();
        this.scanAndRegisterTurns();
        this.scheduleVirtualize();
      }

      this.updateStats();
    }

    onStatsChange(cb) {
      this.onStatsChangeCallbacks.add(cb);
    }

    onIndexUpdate(cb) {
      this.onIndexUpdateCallbacks.add(cb);
    }

    startPeriodicScan() {
      // Continuous scanner ensures dynamic turns loaded via async API in ChatGPT are captured
      this.scanInterval = setInterval(() => {
        if (this.options.enabled && this.options.mode !== 'off') {
          const prevCount = this.turns.length;
          this.scanAndRegisterTurns();
          if (this.turns.length !== prevCount) {
            this.scheduleVirtualize();
          }
        }
      }, 1000);
    }

    startRouteWatcher() {
      // Monitor SPA URL navigation in ChatGPT / Next.js
      setInterval(() => {
        if (window.location.href !== this.lastUrl) {
          console.log('[HPruner] SPA Navigation detected:', this.lastUrl, '->', window.location.href);
          this.lastUrl = window.location.href;
          this.resetForNewConversation();
        }
      }, 600);

      window.addEventListener('popstate', () => this.resetForNewConversation());
    }

    resetForNewConversation() {
      this.turns = [];
      this.turnMap.clear();
      this.findScrollContainer();
      this.scanAndRegisterTurns();
      this.scheduleVirtualize();
    }

    // Identifies ChatGPT / LLM chat scroll container
    findScrollContainer() {
      const candidates = [
        document.querySelector('div[class*="react-scroll-to-bottom"]'),
        document.querySelector('main div.overflow-y-auto'),
        document.querySelector('main div[class*="overflow-y-auto"]'),
        document.querySelector('div[class*="overflow-y-auto"]'),
        document.querySelector('main[class*="overflow-y-auto"]'),
        document.querySelector('div[id="chat-scroll-container"]'), // Demo harness
        document.querySelector('main'),
        document.querySelector('#__next')
      ];

      for (const el of candidates) {
        if (el && (el.scrollHeight > el.clientHeight || el.clientHeight > 300)) {
          this.scrollContainer = el;
          return el;
        }
      }

      const allDivs = document.querySelectorAll('main div');
      for (const el of allDivs) {
        const style = window.getComputedStyle(el);
        if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > 300) {
          this.scrollContainer = el;
          return el;
        }
      }

      this.scrollContainer = window;
      return window;
    }

    handleScroll() {
      this.isScrolling = true;
      clearTimeout(this.scrollTimeout);
      this.scrollTimeout = setTimeout(() => {
        this.isScrolling = false;
      }, 120);

      this.scheduleVirtualize();
    }

    scheduleVirtualize() {
      if (this.rafId) return;
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        this.virtualize();
      });
    }

    setupResizeObserver() {
      this.resizeObserver = new ResizeObserver((entries) => {
        let needsRecompute = false;
        for (const entry of entries) {
          const target = entry.target;
          const record = this.turnMap.get(target);
          if (record && record.isMounted) {
            const newHeight = entry.borderBoxSize?.[0]?.blockSize || entry.contentRect.height;
            if (newHeight > 0 && Math.abs(newHeight - record.measuredHeight) > 2) {
              const heightDiff = newHeight - record.measuredHeight;
              record.measuredHeight = newHeight;
              needsRecompute = true;

              // Upward scroll anchoring compensation
              if (this.options.autoScrollFix && this.scrollContainer && this.scrollContainer !== window) {
                const containerRect = this.getContainerRect();
                const targetRect = target.getBoundingClientRect();
                if (targetRect.bottom < containerRect.top) {
                  this.scrollContainer.scrollTop += heightDiff;
                }
              }
            }
          }
        }

        if (needsRecompute) {
          this.scheduleVirtualize();
        }
      });
    }

    startObservingDOM() {
      this.mutationObserver = new MutationObserver((mutations) => {
        let shouldScan = false;
        for (const m of mutations) {
          if (m.target && (m.target.closest && (m.target.closest('#hpruner-floating-hud') || m.target.closest('#hpruner-search-modal')))) {
            continue;
          }
          if (m.addedNodes.length > 0 || m.removedNodes.length > 0) {
            shouldScan = true;
            break;
          }
        }
        if (shouldScan) {
          this.scanAndRegisterTurns();
          this.scheduleVirtualize();
        }
      });

      this.mutationObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
    }

    startFPSMeter() {
      let lastTime = performance.now();
      let frames = 0;

      const loop = (now) => {
        frames++;
        if (now >= lastTime + 800) {
          const delta = now - lastTime;
          this.stats.fps = Math.min(60, Math.round((frames * 1000) / delta));
          frames = 0;
          lastTime = now;
          this.notifyStats();
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }

    // Comprehensive turn selector covering all ChatGPT revisions (2023-2026), Claude, and custom chats
    getTurnElements() {
      const selectors = [
        'article',
        '[data-message-author-role]',
        '[data-testid^="conversation-turn-"]',
        '[data-testid*="conversation-turn"]',
        'div[class*="group/conversation-turn"]',
        'div[class*="agent-turn"]',
        'div[class*="user-turn"]',
        'div[class*="conversation-item"]',
        '[data-message-id]',
        '.chat-message-turn', // Demo harness
        '.hpruner-message-turn'
      ];

      if (this.options.customSelectors) {
        selectors.unshift(this.options.customSelectors);
      }

      for (const sel of selectors) {
        try {
          const els = Array.from(document.querySelectorAll(sel));
          if (els.length > 0) {
            // Filter out navigation, sidebar, or extension UI
            const chatTurns = els.filter(el => {
              const isInsideNav = el.closest('nav, header, [role="navigation"], aside:not(.chat-viewport)');
              const isInsideExtension = el.closest('#hpruner-search-modal, #hpruner-floating-hud');
              return !isInsideNav && !isInsideExtension;
            });

            // Keep top-level turn elements (remove nested matches)
            const topLevelTurns = chatTurns.filter(el => {
              return !chatTurns.some(other => other !== el && other.contains(el));
            });

            if (topLevelTurns.length > 0) {
              return topLevelTurns;
            }
          }
        } catch (e) {
          // ignore selector errors
        }
      }

      return [];
    }

    scanAndRegisterTurns() {
      const elements = this.getTurnElements();
      let hasNew = false;
      const currentElementSet = new Set(elements);

      // Remove vanished elements
      this.turns = this.turns.filter(turn => {
        if (!currentElementSet.has(turn.element) || !document.contains(turn.element)) {
          this.turnMap.delete(turn.element);
          if (this.resizeObserver) this.resizeObserver.unobserve(turn.element);
          return false;
        }
        return true;
      });

      // Register new elements
      elements.forEach((el, index) => {
        let record = this.turnMap.get(el);
        if (!record) {
          const turnId = el.getAttribute('data-testid') || el.getAttribute('data-message-id') || el.id || `turn-${Date.now()}-${index}`;
          const currentHeight = el.getBoundingClientRect().height || 100;
          
          record = {
            id: turnId,
            index: index,
            element: el,
            measuredHeight: Math.max(currentHeight, 40),
            isMounted: true,
            isStreaming: false,
            role: this.detectRole(el),
            textContent: el.textContent || ''
          };

          this.turnMap.set(el, record);
          this.turns.push(record);
          if (this.resizeObserver) this.resizeObserver.observe(el);
          hasNew = true;
        } else {
          record.index = index;
          if (record.isMounted && el.textContent) {
            record.textContent = el.textContent;
          }
        }
      });

      // Sort by position in DOM
      this.turns.sort((a, b) => {
        const pos = a.element.compareDocumentPosition(b.element);
        return (pos & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
      });

      if (hasNew) {
        this.notifyIndexUpdate();
      }
    }

    detectRole(element) {
      if (element.getAttribute('data-message-author-role')) {
        return element.getAttribute('data-message-author-role');
      }
      const html = element.innerHTML || '';
      if (element.querySelector('[data-role="user"]') || html.includes('user-avatar') || element.classList.contains('user-turn')) {
        return 'user';
      }
      return 'assistant';
    }

    isTurnStreaming(record, index, total) {
      if (!this.options.safeStreamingGuard) return false;
      const isLast = (index >= total - 1);
      const el = record.element;
      
      const hasStreamingIndicator = (
        el.querySelector('.result-streaming') ||
        el.querySelector('[data-is-streaming="true"]') ||
        el.querySelector('button[aria-label="Stop generating"]') ||
        el.classList.contains('result-streaming') ||
        el.querySelector('.streaming-cursor')
      );

      const hasGlobalStopBtn = document.querySelector('button[aria-label="Stop generating"], button[data-testid="stop-button"]');

      return Boolean(hasStreamingIndicator || (isLast && hasGlobalStopBtn));
    }

    getContainerRect() {
      if (!this.scrollContainer || this.scrollContainer === window) {
        return {
          top: 0,
          bottom: window.innerHeight,
          height: window.innerHeight,
          scrollTop: window.scrollY || document.documentElement.scrollTop
        };
      }
      const rect = this.scrollContainer.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
        scrollTop: this.scrollContainer.scrollTop
      };
    }

    virtualize() {
      if (!this.options.enabled || this.options.mode === 'off' || this.turns.length === 0) {
        return;
      }

      const containerRect = this.getContainerRect();
      const buffer = this.options.overscanBuffer || 550;
      const viewportTop = containerRect.top - buffer;
      const viewportBottom = containerRect.bottom + buffer;

      let renderedCount = 0;
      let prunedCount = 0;
      const total = this.turns.length;

      this.turns.forEach((record, idx) => {
        const el = record.element;
        if (!el || !document.contains(el)) return;

        const isStreaming = this.isTurnStreaming(record, idx, total);
        record.isStreaming = isStreaming;

        const rect = el.getBoundingClientRect();
        
        // Check if element intersects [viewportTop, viewportBottom]
        const isVisible = isStreaming || (rect.bottom >= viewportTop && rect.top <= viewportBottom);

        if (isVisible) {
          if (!record.isMounted) {
            this.mountTurn(record);
          }
          renderedCount++;
        } else {
          if (record.isMounted) {
            this.unmountTurn(record);
          }
          prunedCount++;
        }
      });

      this.stats.totalTurns = total;
      this.stats.renderedTurns = renderedCount;
      this.stats.prunedTurns = prunedCount;
      this.updateStats();
    }

    mountTurn(record) {
      const el = record.element;
      if (!el) return;

      el.classList.remove('hpruner-pruned-ghost');
      el.removeAttribute('data-hpruner-pruned');
      el.style.removeProperty('content-visibility');
      el.style.removeProperty('contain-intrinsic-size');
      el.style.removeProperty('min-height');
      el.style.removeProperty('height');
      el.style.removeProperty('width');

      record.isMounted = true;

      if (this.resizeObserver) {
        this.resizeObserver.observe(el);
      }
    }

    unmountTurn(record) {
      const el = record.element;
      if (!el || record.isStreaming) return;

      const currentHeight = el.getBoundingClientRect().height;
      if (currentHeight > 30) {
        record.measuredHeight = currentHeight;
      }

      if (!record.textContent) {
        record.textContent = el.textContent || '';
      }

      // Hardware CSS Containment & Virtualization (100% React-safe)
      el.classList.add('hpruner-pruned-ghost');
      el.setAttribute('data-hpruner-pruned', 'true');
      el.style.setProperty('content-visibility', 'hidden', 'important');
      el.style.setProperty('contain-intrinsic-size', `auto ${record.measuredHeight}px`, 'important');
      el.style.setProperty('min-height', `${record.measuredHeight}px`, 'important');
      el.style.setProperty('height', `${record.measuredHeight}px`, 'important');
      el.style.setProperty('width', '100%', 'important');

      record.isMounted = false;
    }

    restoreAll() {
      this.turns.forEach(record => {
        this.mountTurn(record);
      });
      this.stats.renderedTurns = this.turns.length;
      this.stats.prunedTurns = 0;
      this.updateStats();
    }

    scrollToIndex(index) {
      if (index < 0 || index >= this.turns.length) return;
      const targetRecord = this.turns[index];
      if (!targetRecord) return;

      for (let i = Math.max(0, index - 2); i <= Math.min(this.turns.length - 1, index + 2); i++) {
        const rec = this.turns[i];
        if (rec) this.mountTurn(rec);
      }

      targetRecord.element.scrollIntoView({ behavior: 'smooth', block: 'center' });

      targetRecord.element.classList.remove('hpruner-highlight-pulse');
      void targetRecord.element.offsetWidth;
      targetRecord.element.classList.add('hpruner-highlight-pulse');
      setTimeout(() => {
        targetRecord.element.classList.remove('hpruner-highlight-pulse');
      }, 2500);

      this.scheduleVirtualize();
    }

    updateStats() {
      const avgNodeMemKB = 120;
      const savedKB = this.stats.prunedTurns * avgNodeMemKB;
      this.stats.estimatedMemorySavedMB = (savedKB / 1024).toFixed(1);
      this.stats.enabled = this.options.enabled;
      this.stats.mode = this.options.mode;

      this.notifyStats();
    }

    notifyStats() {
      for (const cb of this.onStatsChangeCallbacks) {
        cb(this.stats);
      }
    }

    notifyIndexUpdate() {
      for (const cb of this.onIndexUpdateCallbacks) {
        cb(this.turns);
      }
    }

    destroy() {
      if (this.scanInterval) clearInterval(this.scanInterval);
      if (this.resizeObserver) this.resizeObserver.disconnect();
      if (this.mutationObserver) this.mutationObserver.disconnect();
      if (this.handleScrollBound) {
        window.removeEventListener('scroll', this.handleScrollBound, { capture: true });
        document.removeEventListener('scroll', this.handleScrollBound, { capture: true });
      }
      this.restoreAll();
      this.isInitialized = false;
    }
  }

  window.HPrunerVirtualizer = HPrunerVirtualizer;
})();
