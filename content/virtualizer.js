// content/virtualizer.js - Production-Grade ChatGPT & Chat DOM Virtualizer with Progressive Reader Mode
(function () {
  'use strict';

  class HPrunerVirtualizer {
    constructor(options = {}) {
      this.options = Object.assign({
        enabled: true,
        mode: 'progressive', // 'progressive' (Slow/smooth background hydration), 'balanced' (550px), 'ultra' (250px), 'eco', 'off'
        overscanBuffer: 600,
        safeStreamingGuard: true,
        autoScrollFix: true,
        customSelectors: '',
        staggerDelayMs: 45 // Delay between progressive mounts
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

      // Progressive Hydration Queue
      this.hydrationQueue = [];
      this.hydrationTimer = null;
      this.isHydrating = false;
      this.idlePrehydrateTimer = null;

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

    // Capture-phase scroll listener catches all scroll events on window, document, or nested divs
    setupGlobalScrollCapture() {
      this.handleScrollBound = () => this.handleScroll();
      window.addEventListener('scroll', this.handleScrollBound, { passive: true, capture: true });
      document.addEventListener('scroll', this.handleScrollBound, { passive: true, capture: true });
      window.addEventListener('resize', () => this.scheduleVirtualize(), { passive: true });
    }

    setOptions(newOptions) {
      this.options = Object.assign(this.options, newOptions);

      if (this.options.mode === 'progressive') {
        this.options.overscanBuffer = 650;
      } else if (this.options.mode === 'ultra') {
        this.options.overscanBuffer = 250;
      } else if (this.options.mode === 'balanced') {
        this.options.overscanBuffer = 550;
      } else if (this.options.mode === 'eco') {
        this.options.overscanBuffer = 850;
      }

      this.stopHydrationQueue();

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
      this.stopHydrationQueue();
      this.turns = [];
      this.turnMap.clear();
      this.findScrollContainer();
      this.scanAndRegisterTurns();
      this.scheduleVirtualize();
    }

    findScrollContainer() {
      const candidates = [
        document.querySelector('div[class*="react-scroll-to-bottom"]'),
        document.querySelector('main div.overflow-y-auto'),
        document.querySelector('main div[class*="overflow-y-auto"]'),
        document.querySelector('div[class*="overflow-y-auto"]'),
        document.querySelector('main[class*="overflow-y-auto"]'),
        document.querySelector('div[id="chat-scroll-container"]'),
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
      clearTimeout(this.idlePrehydrateTimer);

      // Pause progressive queue during fast scroll to ensure 60 FPS
      if (this.options.mode === 'progressive') {
        this.stopHydrationQueue();
      }

      this.scrollTimeout = setTimeout(() => {
        this.isScrolling = false;
        // When scrolling stops and user is reading, start gentle idle pre-hydration
        if (this.options.mode === 'progressive') {
          this.scheduleIdlePrehydration();
        }
      }, 140);

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
        '.chat-message-turn',
        '.hpruner-message-turn'
      ];

      if (this.options.customSelectors) {
        selectors.unshift(this.options.customSelectors);
      }

      for (const sel of selectors) {
        try {
          const els = Array.from(document.querySelectorAll(sel));
          if (els.length > 0) {
            const chatTurns = els.filter(el => {
              const isInsideNav = el.closest('nav, header, [role="navigation"], aside:not(.chat-viewport)');
              const isInsideExtension = el.closest('#hpruner-search-modal, #hpruner-floating-hud');
              return !isInsideNav && !isInsideExtension;
            });

            const topLevelTurns = chatTurns.filter(el => {
              return !chatTurns.some(other => other !== el && other.contains(el));
            });

            if (topLevelTurns.length > 0) {
              return topLevelTurns;
            }
          }
        } catch (e) {}
      }

      return [];
    }

    scanAndRegisterTurns() {
      const elements = this.getTurnElements();
      let hasNew = false;
      const currentElementSet = new Set(elements);

      this.turns = this.turns.filter(turn => {
        if (!currentElementSet.has(turn.element) || !document.contains(turn.element)) {
          this.turnMap.delete(turn.element);
          if (this.resizeObserver) this.resizeObserver.unobserve(turn.element);
          return false;
        }
        return true;
      });

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
      const buffer = this.options.overscanBuffer || 600;
      
      // Strict physical screen viewport (what user is reading right now)
      const screenTop = containerRect.top;
      const screenBottom = containerRect.bottom;
      
      // Extended overscan buffer boundary
      const bufferTop = containerRect.top - buffer;
      const bufferBottom = containerRect.bottom + buffer;

      let renderedCount = 0;
      let prunedCount = 0;
      const total = this.turns.length;

      const progressiveQueue = [];

      this.turns.forEach((record, idx) => {
        const el = record.element;
        if (!el || !document.contains(el)) return;

        const isStreaming = this.isTurnStreaming(record, idx, total);
        record.isStreaming = isStreaming;

        const rect = el.getBoundingClientRect();

        // 1. Direct on-screen visible items (Priority 1: Immediate Mount)
        const isOnScreen = isStreaming || (rect.bottom >= screenTop && rect.top <= screenBottom);
        
        // 2. In overscan buffer area (Priority 2: Progressive / Smooth Mount)
        const isInBuffer = (rect.bottom >= bufferTop && rect.top <= bufferBottom);

        if (isOnScreen) {
          if (!record.isMounted) {
            this.mountTurn(record);
          }
          renderedCount++;
        } else if (isInBuffer) {
          if (this.options.mode === 'progressive') {
            if (!record.isMounted) {
              // Add to progressive queue to hydrate slowly one-by-one
              const distFromCenter = Math.abs((rect.top + rect.bottom) / 2 - (screenTop + screenBottom) / 2);
              progressiveQueue.push({ record, dist: distFromCenter });
              prunedCount++;
            } else {
              renderedCount++;
            }
          } else {
            // Balanced or Ultra mode: Immediate buffer mount
            if (!record.isMounted) {
              this.mountTurn(record);
            }
            renderedCount++;
          }
        } else {
          // Off-screen outside buffer: Unmount smoothly
          if (record.isMounted) {
            this.unmountTurn(record);
          }
          prunedCount++;
        }
      });

      // In Progressive mode, start slowly hydrating adjacent turns in the background
      if (this.options.mode === 'progressive' && progressiveQueue.length > 0) {
        // Sort queue so nearest items to current viewport hydrate first
        progressiveQueue.sort((a, b) => a.dist - b.dist);
        this.enqueueProgressiveHydration(progressiveQueue.map(item => item.record));
      }

      this.stats.totalTurns = total;
      this.stats.renderedTurns = renderedCount;
      this.stats.prunedTurns = prunedCount;
      this.updateStats();
    }

    // Progressive background hydration: mounts 1 turn at a time with smooth micro-delays
    enqueueProgressiveHydration(records) {
      this.hydrationQueue = records;
      if (this.isHydrating) return;
      this.processNextHydrationItem();
    }

    processNextHydrationItem() {
      if (this.hydrationQueue.length === 0 || this.isScrolling) {
        this.isHydrating = false;
        return;
      }

      this.isHydrating = true;
      const record = this.hydrationQueue.shift();

      if (record && !record.isMounted && document.contains(record.element)) {
        this.mountTurn(record, true); // true = smooth subtle fade
        this.stats.renderedTurns++;
        this.stats.prunedTurns = Math.max(0, this.stats.prunedTurns - 1);
        this.updateStats();
      }

      // Schedule next item gently via requestIdleCallback / setTimeout
      const delay = this.options.staggerDelayMs || 45;
      this.hydrationTimer = setTimeout(() => {
        if ('requestIdleCallback' in window) {
          window.requestIdleCallback(() => this.processNextHydrationItem(), { timeout: 80 });
        } else {
          this.processNextHydrationItem();
        }
      }, delay);
    }

    stopHydrationQueue() {
      clearTimeout(this.hydrationTimer);
      this.hydrationQueue = [];
      this.isHydrating = false;
    }

    // When the user is stationary/reading for > 300ms, slowly pre-hydrate nearby items in the background
    scheduleIdlePrehydration() {
      this.idlePrehydrateTimer = setTimeout(() => {
        if (this.isScrolling || this.options.mode !== 'progressive') return;

        const containerRect = this.getContainerRect();
        const screenTop = containerRect.top;
        const screenBottom = containerRect.bottom;

        // Find nearest unmounted turns within reading reach
        const candidates = [];
        this.turns.forEach(record => {
          if (!record.isMounted && document.contains(record.element)) {
            const rect = record.element.getBoundingClientRect();
            const dist = Math.abs((rect.top + rect.bottom) / 2 - (screenTop + screenBottom) / 2);
            if (dist < 1200) { // within 2 pages of reading
              candidates.push({ record, dist });
            }
          }
        });

        if (candidates.length > 0) {
          candidates.sort((a, b) => a.dist - b.dist);
          this.enqueueProgressiveHydration(candidates.slice(0, 4).map(c => c.record));
        }
      }, 300);
    }

    mountTurn(record, smooth = false) {
      const el = record.element;
      if (!el) return;

      el.classList.remove('hpruner-pruned-ghost');
      el.removeAttribute('data-hpruner-pruned');
      el.style.removeProperty('content-visibility');
      el.style.removeProperty('contain-intrinsic-size');
      el.style.removeProperty('min-height');
      el.style.removeProperty('height');
      el.style.removeProperty('width');

      if (smooth) {
        el.classList.add('hpruner-smooth-fade');
        setTimeout(() => el.classList.remove('hpruner-smooth-fade'), 250);
      }

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
      this.stopHydrationQueue();
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
      this.stopHydrationQueue();
      clearTimeout(this.idlePrehydrateTimer);
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
