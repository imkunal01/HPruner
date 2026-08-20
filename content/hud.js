// content/hud.js - Minimalist Floating In-Page Telemetry Badge
(function () {
  'use strict';

  class HPrunerHUD {
    constructor(virtualizer, searchOverlay) {
      this.virtualizer = virtualizer;
      this.searchOverlay = searchOverlay;
      this.container = null;
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
      this.container.className = 'hpruner-hud-badge';

      this.container.innerHTML = `
        <div class="hpruner-hud-capsule">
          <div class="hpruner-hud-beacon" id="hpruner-hud-beacon" title="HPruner Active"></div>
          
          <div class="hpruner-hud-metrics" id="hpruner-hud-metrics" title="Mounted / Total Turns">
            <span class="hpruner-hud-fps mono" id="hpruner-hud-fps">60 FPS</span>
            <span class="hpruner-hud-sep">•</span>
            <span class="hpruner-hud-turns mono" id="hpruner-hud-turns">0/0</span>
          </div>

          <div class="hpruner-hud-actions">
            <button class="hpruner-hud-action-btn" id="hpruner-hud-search-btn" title="Search thread (Ctrl+Shift+F)">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </button>
            <button class="hpruner-hud-action-btn" id="hpruner-hud-toggle-btn" title="Toggle Virtualization">
              <span class="hpruner-toggle-dot active"></span>
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(this.container);

      // Restore position if saved
      const savedPos = localStorage.getItem('hpruner_hud_pos_v2');
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
      const capsule = this.container.querySelector('.hpruner-hud-capsule');
      const searchBtn = this.container.querySelector('#hpruner-hud-search-btn');
      const toggleBtn = this.container.querySelector('#hpruner-hud-toggle-btn');

      // Dragging logic
      capsule.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        this.isDragging = true;
        const rect = this.container.getBoundingClientRect();
        this.dragOffset.x = e.clientX - rect.left;
        this.dragOffset.y = e.clientY - rect.top;
        this.container.classList.add('dragging');
      });

      window.addEventListener('mousemove', (e) => {
        if (!this.isDragging) return;
        e.preventDefault();
        const left = Math.max(8, Math.min(window.innerWidth - this.container.offsetWidth - 8, e.clientX - this.dragOffset.x));
        const top = Math.max(8, Math.min(window.innerHeight - this.container.offsetHeight - 8, e.clientY - this.dragOffset.y));

        this.container.style.left = `${left}px`;
        this.container.style.top = `${top}px`;
        this.container.style.right = 'auto';
        this.container.style.bottom = 'auto';
      });

      window.addEventListener('mouseup', () => {
        if (this.isDragging) {
          this.isDragging = false;
          this.container.classList.remove('dragging');
          const rect = this.container.getBoundingClientRect();
          const right = `${window.innerWidth - rect.right}px`;
          const bottom = `${window.innerHeight - rect.bottom}px`;
          localStorage.setItem('hpruner_hud_pos_v2', JSON.stringify({ right, bottom }));
        }
      });

      searchBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.searchOverlay) this.searchOverlay.toggle();
      });

      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
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

      const turnsEl = this.container.querySelector('#hpruner-hud-turns');
      const fpsEl = this.container.querySelector('#hpruner-hud-fps');
      const beacon = this.container.querySelector('#hpruner-hud-beacon');
      const toggleDot = this.container.querySelector('.hpruner-toggle-dot');

      if (turnsEl) {
        turnsEl.textContent = `${stats.renderedTurns}/${stats.totalTurns}`;
      }

      if (fpsEl) {
        fpsEl.textContent = `${stats.fps} FPS`;
        if (stats.fps >= 55) {
          fpsEl.style.color = '#10b981';
        } else if (stats.fps >= 40) {
          fpsEl.style.color = '#f59e0b';
        } else {
          fpsEl.style.color = '#ef4444';
        }
      }

      const isActive = stats.enabled && stats.mode !== 'off';
      if (beacon) {
        beacon.className = `hpruner-hud-beacon ${isActive ? 'active' : 'inactive'}`;
      }
      if (toggleDot) {
        toggleDot.className = `hpruner-toggle-dot ${isActive ? 'active' : 'inactive'}`;
      }
    }

    setVisible(visible) {
      if (this.container) {
        this.container.style.display = visible ? 'block' : 'none';
      }
    }
  }

  window.HPrunerHUD = HPrunerHUD;
})();
