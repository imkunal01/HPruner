// content/virtualizer.js - High Performance Chat DOM Virtualizer Engine
(function () {
  'use strict';

  class HPrunerVirtualizer {
    constructor(options = {}) {
      this.options = Object.assign({
        enabled: true,
        mode: 'balanced', // 'ultra' (200px buffer), 'balanced' (500px), 'eco' (content-visibility), 'off'
        overscanBuffer: 500,
        safeStreamingGuard: true,
        autoScrollFix: true,
        customSelectors: ''
      }, options);

      this.isInitialized = false;
      this.scrollContainer = null;
      this.turns = []; // Array of TurnRecord
      this.turnMap = new Map(); // element or turnId -> TurnRecord
      this.resizeObserver = null;
      this.mutationObserver = null;
      this.rafId = null;
      this.lastScrollTop = 0;
      this.isScrolling = false;
      this.scrollTimeout = null;

      // Stats
      this.stats = {
        totalTurns: 0,
        renderedTurns: 0,
        prunedTurns: 0,
        estimatedMemorySavedMB: 0,
        fps: 60,
        enabled: this.options.enabled,
        mode: this.options.mode
      };

      // FPS Tracker
      this.frameCount = 0;
      this.lastFpsUpdate = performance.now();

      this.onStatsChangeCallbacks = new Set();
      this.onIndexUpdateCallbacks = new Set();

      this.init();
    }

    init() {
      if (this.isInitialized) return;
      this.isInitialized = true;

      this.setupResizeObserver();
      this.findScrollContainer();
      this.startObservingDOM();
      this.startFPSMeter();

      // Initial scan
      this.scanAndRegisterTurns();
      this.scheduleVirtualize();

      console.log('[HPruner] Virtualizer core initialized with mode:', this.options.mode);
    }

    setOptions(newOptions) {
      const prevMode = this.options.mode;
      const prevEnabled = this.options.enabled;
      this.options = Object.assign(this.options, newOptions);

      if (this.options.mode === 'ultra') {
        this.options.overscanBuffer = 250;
      } else if (this.options.mode === 'balanced') {
        this.options.overscanBuffer = 550;
      } else if (this.options.mode === 'eco') {
        this.options.overscanBuffer = 800;
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

    // Identifies ChatGPT / LLM chat scroll container
    findScrollContainer() {
      if (this.scrollContainer && document.contains(this.scrollContainer)) {
        return this.scrollContainer;
      }

      // ChatGPT main scroll container candidates
      const candidates = [
        document.querySelector('div[class*="react-scroll-to-bottom"]'),
        document.querySelector('main div.overflow-y-auto'),
        document.querySelector('main div[class*="overflow-y-auto"]'),
        document.querySelector('main[class*="overflow-y-auto"]'),
        document.querySelector('div[id="chat-scroll-container"]'), // Demo harness
        document.querySelector('.chat-messages-container'),
        document.querySelector('main')
      ];

      for (const el of candidates) {
        if (el && (el.scrollHeight > el.clientHeight || window.getComputedStyle(el).overflowY.includes('auto') || window.getComputedStyle(el).overflowY.includes('scroll'))) {
          this.attachScrollListener(el);
          return el;
        }
      }

      // Fallback: search any element with overflow scroll/auto
      const allDivs = document.querySelectorAll('main div, #__next div');
      for (const el of allDivs) {
        const style = window.getComputedStyle(el);
        if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight && el.clientHeight > 300) {
          this.attachScrollListener(el);
          return el;
        }
      }

      // Window fallback
      this.attachScrollListener(window);
      return window;
    }

    attachScrollListener(container) {
      if (this.scrollContainer === container) return;

      if (this.scrollContainer) {
        this.scrollContainer.removeEventListener('scroll', this.handleScrollBound);
      }

      this.scrollContainer = container;
      this.handleScrollBound = () => this.handleScroll();

      if (this.scrollContainer.addEventListener) {
        this.scrollContainer.addEventListener('scroll', this.handleScrollBound, { passive: true });
      }

      window.addEventListener('resize', () => this.scheduleVirtualize(), { passive: true });
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
            if (newHeight > 0 && Math.abs(newHeight - record.measuredHeight) > 1.5) {
              const heightDiff = newHeight - record.measuredHeight;
              record.measuredHeight = newHeight;
              needsRecompute = true;

              // Scroll anchoring compensation for upward scrolling:
              // If an item above current viewport top expands or contracts, adjust scrollTop
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
          if (m.addedNodes.length > 0 || m.removedNodes.length > 0) {
            shouldScan = true;
            break;
          }
        }
        if (shouldScan) {
          this.findScrollContainer();
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

    // Selectors for finding turns in ChatGPT / Claude / Custom
    getTurnElements() {
      const selectors = [
        'article[data-testid^="conversation-turn-"]',
        'article[class*="text-token-text-primary"]',
        'article',
        'div[data-message-author-role]',
        'div[class*="group/conversation-turn"]',
        '[data-testid*="conversation-turn"]',
        '.chat-message-turn', // Demo harness
        '.hpruner-message-turn'
      ];

      if (this.options.customSelectors) {
        selectors.unshift(this.options.customSelectors);
      }

      for (const sel of selectors) {
        try {
          const els = Array.from(document.querySelectorAll(sel));
          // Validate if elements look like messages (at least 1 or within chat main)
          if (els.length > 0) {
            // Filter out navigation/sidebar articles if any
            const chatTurns = els.filter(el => {
              const isInsideNav = el.closest('nav, header, [role="navigation"]');
              return !isInsideNav;
            });
            if (chatTurns.length > 0) return chatTurns;
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
        if (!currentElementSet.has(turn.element)) {
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
          const turnId = el.getAttribute('data-testid') || el.id || `turn-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 4)}`;
          const initialHeight = el.getBoundingClientRect().height || 120;
          
          record = {
            id: turnId,
            index: index,
            element: el,
            measuredHeight: Math.max(initialHeight, 40),
            isMounted: true,
            isStreaming: false,
            role: this.detectRole(el),
            cachedFragment: null,
            cachedInnerHTML: null,
            textContent: el.textContent || ''
          };

          this.turnMap.set(el, record);
          this.turns.push(record);
          if (this.resizeObserver) this.resizeObserver.observe(el);
          hasNew = true;
        } else {
          record.index = index;
          // Refresh text content for search index if mounted
          if (record.isMounted && el.textContent) {
            record.textContent = el.textContent;
          }
        }
      });

      // Keep turns sorted by document order
      this.turns.sort((a, b) => a.index - b.index);

      if (hasNew) {
        this.notifyIndexUpdate();
      }
    }

    detectRole(element) {
      if (element.getAttribute('data-message-author-role')) {
        return element.getAttribute('data-message-author-role');
      }
      const text = element.innerHTML || '';
      if (element.querySelector('[data-role="user"]') || text.includes('user-bubble') || element.classList.contains('user-turn')) {
        return 'user';
      }
      if (element.querySelector('[data-role="assistant"]') || text.includes('agent-turn') || element.classList.contains('assistant-turn')) {
        return 'assistant';
      }
      // Heuristic: user turns are usually shorter or have specific avatars
      return 'assistant';
    }

    isTurnStreaming(record, index, total) {
      if (!this.options.safeStreamingGuard) return false;
      // Always treat the very last message as potentially streaming if generating
      const isLast = (index === total - 1);
      const el = record.element;
      
      const hasStreamingIndicator = (
        el.querySelector('.result-streaming') ||
        el.querySelector('[data-is-streaming="true"]') ||
        el.querySelector('button[aria-label="Stop generating"]') ||
        el.classList.contains('result-streaming') ||
        el.querySelector('.streaming-cursor')
      );

      return Boolean(hasStreamingIndicator || (isLast && document.querySelector('button[aria-label="Stop generating"]')));
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
      const buffer = this.options.overscanBuffer || 500;
      const viewportTop = containerRect.top - buffer;
      const viewportBottom = containerRect.bottom + buffer;

      let renderedCount = 0;
      let prunedCount = 0;
      const total = this.turns.length;

      // When in ECO mode, use CSS containment & content-visibility
      if (this.options.mode === 'eco') {
        this.turns.forEach((record) => {
          this.applyEcoContainment(record);
          renderedCount++;
        });
        this.stats.totalTurns = total;
        this.stats.renderedTurns = renderedCount;
        this.stats.prunedTurns = 0;
        this.updateStats();
        return;
      }

      // Ultra or Balanced Mode: True memory / ghost spacer detachment
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

      // Restore children / inner subtree
      if (record.cachedFragment) {
        el.innerHTML = '';
        el.appendChild(record.cachedFragment);
        record.cachedFragment = null;
      } else if (record.cachedInnerHTML !== null) {
        el.innerHTML = record.cachedInnerHTML;
        record.cachedInnerHTML = null;
      }

      // Clean ghost spacer styles
      el.classList.remove('hpruner-pruned-ghost');
      el.removeAttribute('data-hpruner-pruned');
      el.style.minHeight = '';
      el.style.height = '';
      el.style.contain = '';

      record.isMounted = true;

      // Re-observe exact size
      if (this.resizeObserver) {
        this.resizeObserver.observe(el);
      }
    }

    unmountTurn(record) {
      const el = record.element;
      if (!el || record.isStreaming) return;

      // Record exact pixel height before detaching subtree
      const currentHeight = el.getBoundingClientRect().height;
      if (currentHeight > 30) {
        record.measuredHeight = currentHeight;
      }

      // Snapshot text content for search index
      if (!record.textContent) {
        record.textContent = el.textContent || '';
      }

      // Cache DOM subtree or HTML
      // Creating a DocumentFragment keeps event listeners and React fiber references preserved!
      const fragment = document.createDocumentFragment();
      while (el.firstChild) {
        fragment.appendChild(el.firstChild);
      }
      record.cachedFragment = fragment;

      // Replace inner content with ultra-lightweight ghost placeholder
      const placeholder = document.createElement('div');
      placeholder.className = 'hpruner-ghost-placeholder';
      placeholder.setAttribute('data-role', record.role);
      placeholder.innerHTML = `
        <div class="hpruner-ghost-indicator">
          <span class="hpruner-ghost-dot"></span>
          <span class="hpruner-ghost-label">Turn #${record.index + 1} (${record.role}) • ${Math.round(record.measuredHeight)}px pruned</span>
        </div>
      `;
      el.appendChild(placeholder);

      // Lock height on wrapper so layout never shifts
      el.classList.add('hpruner-pruned-ghost');
      el.setAttribute('data-hpruner-pruned', 'true');
      el.style.minHeight = `${record.measuredHeight}px`;
      el.style.height = `${record.measuredHeight}px`;
      el.style.contain = 'strict';

      record.isMounted = false;
    }

    applyEcoContainment(record) {
      const el = record.element;
      if (!el) return;
      if (!record.isMounted) {
        this.mountTurn(record);
      }
      el.style.contentVisibility = 'auto';
      el.style.containIntrinsicSize = `auto ${record.measuredHeight}px`;
      el.classList.add('hpruner-eco-contained');
    }

    restoreAll() {
      this.turns.forEach(record => {
        if (!record.isMounted) {
          this.mountTurn(record);
        }
        const el = record.element;
        if (el) {
          el.style.contentVisibility = '';
          el.style.containIntrinsicSize = '';
          el.classList.remove('hpruner-eco-contained');
          el.classList.remove('hpruner-pruned-ghost');
        }
      });
      this.stats.renderedTurns = this.turns.length;
      this.stats.prunedTurns = 0;
      this.updateStats();
    }

    // Jump to turn index (used by Search overlay)
    scrollToIndex(index) {
      if (index < 0 || index >= this.turns.length) return;
      const targetRecord = this.turns[index];
      if (!targetRecord) return;

      // Mount target and adjacent items
      for (let i = Math.max(0, index - 2); i <= Math.min(this.turns.length - 1, index + 2); i++) {
        const rec = this.turns[i];
        if (!rec.isMounted) {
          this.mountTurn(rec);
        }
      }

      // Smooth scroll target element into center of viewport
      targetRecord.element.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Visual pulse highlight
      targetRecord.element.classList.remove('hpruner-highlight-pulse');
      void targetRecord.element.offsetWidth; // trigger reflow
      targetRecord.element.classList.add('hpruner-highlight-pulse');
      setTimeout(() => {
        targetRecord.element.classList.remove('hpruner-highlight-pulse');
      }, 2500);

      this.scheduleVirtualize();
    }

    updateStats() {
      // Memory estimation: avg rich LLM turn DOM subtree is ~120KB (DOM tree, syntax highlighters, KaTeX, SVGs, GPU paint textures)
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
      if (this.resizeObserver) this.resizeObserver.disconnect();
      if (this.mutationObserver) this.mutationObserver.disconnect();
      if (this.scrollContainer && this.handleScrollBound) {
        this.scrollContainer.removeEventListener('scroll', this.handleScrollBound);
      }
      this.restoreAll();
      this.isInitialized = false;
    }
  }

  // Export to window for extension access
  window.HPrunerVirtualizer = HPrunerVirtualizer;
})();
