// content/search.js - Global In-Memory Thread Search Overlay
(function () {
  'use strict';

  class HPrunerSearchOverlay {
    constructor(virtualizer) {
      this.virtualizer = virtualizer;
      this.isOpen = false;
      this.container = null;
      this.input = null;
      this.resultsList = null;
      this.results = [];
      this.currentMatchIndex = 0;
      this.debounceTimer = null;

      this.init();
    }

    init() {
      this.createDOM();
      this.attachEventListeners();
    }

    createDOM() {
      if (document.getElementById('hpruner-search-modal')) return;

      this.container = document.createElement('div');
      this.container.id = 'hpruner-search-modal';
      this.container.className = 'hpruner-search-modal hpruner-hidden';

      this.container.innerHTML = `
        <div class="hpruner-search-backdrop"></div>
        <div class="hpruner-search-dialog">
          <div class="hpruner-search-header">
            <div class="hpruner-search-input-wrapper">
              <svg class="hpruner-search-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input type="text" id="hpruner-search-input" placeholder="Search entire thread history (in-memory)..." autocomplete="off" spellcheck="false" />
              <div class="hpruner-search-badge" id="hpruner-match-counter">0 matches</div>
            </div>
            <div class="hpruner-search-actions">
              <button class="hpruner-btn-icon" id="hpruner-search-prev" title="Previous match (Shift+Enter)">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"></polyline></svg>
              </button>
              <button class="hpruner-btn-icon" id="hpruner-search-next" title="Next match (Enter)">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </button>
              <button class="hpruner-btn-icon hpruner-btn-close" id="hpruner-search-close" title="Close (Esc)">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
          </div>
          <div class="hpruner-search-body">
            <div class="hpruner-search-results" id="hpruner-results-list">
              <div class="hpruner-search-empty">Type to search through all active and pruned conversation messages.</div>
            </div>
          </div>
          <div class="hpruner-search-footer">
            <span><kbd>↑</kbd> <kbd>↓</kbd> navigate</span>
            <span><kbd>Enter</kbd> jump to turn</span>
            <span><kbd>Esc</kbd> close</span>
          </div>
        </div>
      `;

      document.body.appendChild(this.container);

      this.input = this.container.querySelector('#hpruner-search-input');
      this.resultsList = this.container.querySelector('#hpruner-results-list');
      this.matchCounter = this.container.querySelector('#hpruner-match-counter');
    }

    attachEventListeners() {
      // Toggle shortcut Ctrl+Shift+F
      window.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
          e.preventDefault();
          this.toggle();
        } else if (e.key === 'Escape' && this.isOpen) {
          e.preventDefault();
          this.close();
        }
      });

      this.container.querySelector('.hpruner-search-backdrop').addEventListener('click', () => this.close());
      this.container.querySelector('#hpruner-search-close').addEventListener('click', () => this.close());

      this.input.addEventListener('input', () => {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => this.performSearch(), 120);
      });

      this.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (e.shiftKey) {
            this.navigateMatch(-1);
          } else {
            this.navigateMatch(1);
          }
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.navigateMatch(1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          this.navigateMatch(-1);
        }
      });

      this.container.querySelector('#hpruner-search-prev').addEventListener('click', () => this.navigateMatch(-1));
      this.container.querySelector('#hpruner-search-next').addEventListener('click', () => this.navigateMatch(1));
    }

    toggle() {
      if (this.isOpen) {
        this.close();
      } else {
        this.open();
      }
    }

    open() {
      this.isOpen = true;
      this.container.classList.remove('hpruner-hidden');
      setTimeout(() => this.input.focus(), 50);
      if (this.input.value.trim()) {
        this.performSearch();
      }
    }

    close() {
      this.isOpen = false;
      this.container.classList.add('hpruner-hidden');
      this.input.blur();
    }

    performSearch() {
      const query = this.input.value.trim().toLowerCase();
      if (!query) {
        this.resultsList.innerHTML = '<div class="hpruner-search-empty">Type to search through all active and pruned conversation messages.</div>';
        this.matchCounter.textContent = '0 matches';
        this.results = [];
        this.currentMatchIndex = 0;
        return;
      }

      const turns = this.virtualizer.turns || [];
      this.results = [];

      turns.forEach((turn, idx) => {
        const text = (turn.textContent || '').toLowerCase();
        const matchPos = text.indexOf(query);
        if (matchPos !== -1) {
          // Extract preview snippet around match
          const rawText = turn.textContent || '';
          const start = Math.max(0, matchPos - 50);
          const end = Math.min(rawText.length, matchPos + query.length + 70);
          let snippet = rawText.substring(start, end);
          if (start > 0) snippet = '...' + snippet;
          if (end < rawText.length) snippet = snippet + '...';

          this.results.push({
            turnIndex: idx,
            turn: turn,
            snippet: snippet,
            role: turn.role || 'assistant',
            matchPos: matchPos
          });
        }
      });

      this.renderResults(query);
    }

    renderResults(query) {
      if (this.results.length === 0) {
        this.resultsList.innerHTML = '<div class="hpruner-search-empty">No matching messages found in thread history.</div>';
        this.matchCounter.textContent = '0 matches';
        return;
      }

      this.currentMatchIndex = 0;
      this.matchCounter.textContent = `${this.results.length} match${this.results.length > 1 ? 'es' : ''}`;

      const html = this.results.map((res, i) => {
        const highlightedSnippet = this.escapeAndHighlight(res.snippet, query);
        const isSelected = (i === this.currentMatchIndex) ? 'hpruner-result-selected' : '';
        const roleClass = res.role === 'user' ? 'hpruner-badge-user' : 'hpruner-badge-assistant';

        return `
          <div class="hpruner-result-item ${isSelected}" data-index="${i}" data-turn="${res.turnIndex}">
            <div class="hpruner-result-meta">
              <span class="hpruner-role-badge ${roleClass}">${res.role}</span>
              <span class="hpruner-result-turn-num">Turn #${res.turnIndex + 1}</span>
              ${!res.turn.isMounted ? '<span class="hpruner-ghost-tag">⚡ Pruned</span>' : '<span class="hpruner-mounted-tag">Visible</span>'}
            </div>
            <div class="hpruner-result-snippet">${highlightedSnippet}</div>
          </div>
        `;
      }).join('');

      this.resultsList.innerHTML = html;

      // Click handler for results
      this.resultsList.querySelectorAll('.hpruner-result-item').forEach(item => {
        item.addEventListener('click', () => {
          const idx = parseInt(item.getAttribute('data-index'), 10);
          this.selectMatch(idx, true);
        });
      });

      this.selectMatch(0, false);
    }

    escapeAndHighlight(text, query) {
      const div = document.createElement('div');
      div.textContent = text;
      const escaped = div.innerHTML;
      const reg = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      return escaped.replace(reg, '<mark class="hpruner-highlight">$1</mark>');
    }

    navigateMatch(direction) {
      if (this.results.length === 0) return;
      let nextIndex = this.currentMatchIndex + direction;
      if (nextIndex < 0) nextIndex = this.results.length - 1;
      if (nextIndex >= this.results.length) nextIndex = 0;
      this.selectMatch(nextIndex, true);
    }

    selectMatch(index, shouldJump = true) {
      if (index < 0 || index >= this.results.length) return;
      this.currentMatchIndex = index;

      const items = this.resultsList.querySelectorAll('.hpruner-result-item');
      items.forEach((it, i) => {
        if (i === index) {
          it.classList.add('hpruner-result-selected');
          it.scrollIntoView({ block: 'nearest' });
        } else {
          it.classList.remove('hpruner-result-selected');
        }
      });

      this.matchCounter.textContent = `${index + 1} of ${this.results.length}`;

      if (shouldJump) {
        const targetResult = this.results[index];
        if (targetResult) {
          this.virtualizer.scrollToIndex(targetResult.turnIndex);
        }
      }
    }
  }

  window.HPrunerSearchOverlay = HPrunerSearchOverlay;
})();
