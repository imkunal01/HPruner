// content/hud.js - Floating In-Page Performance HUD & Quick Controls
(function () {
  'use strict';

  class HPrunerHUD {
    constructor(virtualizer, searchOverlay) {
      this.virtualizer = virtualizer;
      this.searchOverlay = searchOverlay;
      this.container = null;
      this.isMinimized = false;
      this.isDragging = false;
      this.dragOffset = { x: 0, y: 0 };

      this.init();
    }

    init() {
      this.createDOM();
      this.attachEvents();
      this.bindVirtualizer();
    }

    createDOM() {
      if (document.getElementById('hpruner-floating-hud')) return;

      this.container = document.createElement('div');
      this.container.id = 'hpruner-floating-hud';
      this.container.className = 'hpruner-hud';

      this.container.innerHTML = `
        <div class="hpruner-hud-inner">
          <div class="hpruner-hud-drag-handle" title="Drag to reposition">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/>
              <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
              <circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
            </svg>
          </div>

          <div class="hpruner-hud-brand">
            <span class="hpruner-hud-logo">⚡</span>
            <span class="hpruner-hud-title">HPruner</span>
          </div>

          <div class="hpruner-hud-stats" id="hpruner-hud-stats-view">
            <div class="hpruner-stat-chip" id="hpruner-hud-nodes" title="Rendered vs Total Message Turns">
              <span class="hpruner-stat-val">0/0</span>
              <span class="hpruner-stat-lbl">DOM</span>
            </div>
            <div class="hpruner-stat-chip" id="hpruner-hud-mem" title="Estimated Memory Saved">
              <span class="hpruner-stat-val">0 MB</span>
              <span class="hpruner-stat-lbl">SAVED</span>
            </div>
            <div class="hpruner-stat-chip hpruner-chip-fps" id="hpruner-hud-fps" title="Scroll Framerate">
              <span class="hpruner-stat-val">60</span>
              <span class="hpruner-stat-lbl">FPS</span>
            </div>
          </div>

          <div class="hpruner-hud-actions">
            <button class="hpruner-hud-btn" id="hpruner-hud-search-btn" title="Search all pruned turns (Ctrl+Shift+F)">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </button>
            <button class="hpruner-hud-btn" id="hpruner-hud-toggle-btn" title="Toggle Virtualization">
              <span class="hpruner-toggle-indicator active"></span>
            </button>
            <button class="hpruner-hud-btn hpruner-hud-btn-min" id="hpruner-hud-min-btn" title="Minimize / Expand">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(this.container);

      // Restore position if saved
      const savedPos = localStorage.getItem('hpruner_hud_pos');
      if (savedPos) {
        try {
          const { right, bottom } = JSON.parse(savedPos);
          this.container.style.right = right;
          this.container.style.bottom = bottom;
          this.container.style.top = 'auto';
          this.container.style.left = 'auto';
        } catch (e) {}
      }
    }

    attachEvents() {
      const dragHandle = this.container.querySelector('.hpruner-hud-drag-handle');
      const minBtn = this.container.querySelector('#hpruner-hud-min-btn');
      const searchBtn = this.container.querySelector('#hpruner-hud-search-btn');
      const toggleBtn = this.container.querySelector('#hpruner-hud-toggle-btn');

      // Dragging logic
      dragHandle.addEventListener('mousedown', (e) => {
        this.isDragging = true;
        const rect = this.container.getBoundingClientRect();
        this.dragOffset.x = e.clientX - rect.left;
        this.dragOffset.y = e.clientY - rect.top;
        this.container.classList.add('dragging');
      });

      window.addEventListener('mousemove', (e) => {
        if (!this.isDragging) return;
        e.preventDefault();
        const left = Math.max(10, Math.min(window.innerWidth - this.container.offsetWidth - 10, e.clientX - this.dragOffset.x));
        const top = Math.max(10, Math.min(window.innerHeight - this.container.offsetHeight - 10, e.clientY - this.dragOffset.y));

        this.container.style.left = `${left}px`;
        this.container.style.top = `${top}px`;
        this.container.style.right = 'auto';
        this.container.style.bottom = 'auto';
      });

      window.addEventListener('mouseup', () => {
        if (this.isDragging) {
          this.isDragging = false;
          this.container.classList.remove('dragging');
          // Save position
          const rect = this.container.getBoundingClientRect();
          const right = `${window.innerWidth - rect.right}px`;
          const bottom = `${window.innerHeight - rect.bottom}px`;
          localStorage.setItem('hpruner_hud_pos', JSON.stringify({ right, bottom }));
        }
      });

      // Minimize toggle
      minBtn.addEventListener('click', () => {
        this.isMinimized = !this.isMinimized;
        this.container.classList.toggle('minimized', this.isMinimized);
      });

      // Search button
      searchBtn.addEventListener('click', () => {
        if (this.searchOverlay) this.searchOverlay.toggle();
      });

      // Quick toggle
      toggleBtn.addEventListener('click', () => {
        const current = this.virtualizer.options.enabled;
        this.virtualizer.setOptions({ enabled: !current });
      });
    }

    bindVirtualizer() {
      this.virtualizer.onStatsChange((stats) => {
        this.updateStats(stats);
      });
    }

    updateStats(stats) {
      if (!this.container) return;

      const nodesChip = this.container.querySelector('#hpruner-hud-nodes .hpruner-stat-val');
      const memChip = this.container.querySelector('#hpruner-hud-mem .hpruner-stat-val');
      const fpsChip = this.container.querySelector('#hpruner-hud-fps .hpruner-stat-val');
      const toggleIndicator = this.container.querySelector('.hpruner-toggle-indicator');

      if (nodesChip) {
        nodesChip.textContent = `${stats.renderedTurns}/${stats.totalTurns}`;
      }

      if (memChip) {
        memChip.textContent = `${stats.estimatedMemorySavedMB} MB`;
      }

      if (fpsChip) {
        fpsChip.textContent = `${stats.fps}`;
        const fpsEl = this.container.querySelector('#hpruner-hud-fps');
        if (fpsEl) {
          if (stats.fps >= 55) {
            fpsEl.style.color = '#10b981';
          } else if (stats.fps >= 40) {
            fpsEl.style.color = '#f59e0b';
          } else {
            fpsEl.style.color = '#ef4444';
          }
        }
      }

      if (toggleIndicator) {
        toggleIndicator.className = `hpruner-toggle-indicator ${stats.enabled && stats.mode !== 'off' ? 'active' : 'inactive'}`;
      }
    }

    setVisible(visible) {
      if (this.container) {
        this.container.style.display = visible ? 'flex' : 'none';
      }
    }
  }

  window.HPrunerHUD = HPrunerHUD;
})();
