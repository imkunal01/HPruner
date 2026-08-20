// demo/demo.js - Benchmark Suite & Virtualizer Controller
(function () {
  'use strict';

  const chatContainer = document.getElementById('chat-scroll-container');
  const chatInner = document.getElementById('chat-content-inner');
  const msgCountSelect = document.getElementById('msg-count-select');
  const btnGenerate = document.getElementById('btn-generate');
  const threadTitle = document.getElementById('chat-thread-title');
  const viewportStatus = document.getElementById('viewport-status');

  // Telemetry DOM
  const liveFps = document.getElementById('live-fps');
  const fpsMeterFill = document.getElementById('fps-meter-fill');
  const liveDomNodes = document.getElementById('live-dom-nodes');
  const liveMountedTurns = document.getElementById('live-mounted-turns');
  const livePrunedPct = document.getElementById('live-pruned-pct');
  const liveRamSaved = document.getElementById('live-ram-saved');

  // Mode buttons
  const engineBtns = document.querySelectorAll('.engine-btn');
  const btnStressScroll = document.getElementById('btn-stress-scroll');
  const btnSimulateStream = document.getElementById('btn-simulate-stream');
  const btnTriggerSearch = document.getElementById('btn-trigger-search');
  const btnScrollBottom = document.getElementById('btn-scroll-bottom');

  let virtualizer = null;
  let searchOverlay = null;
  let hud = null;
  let isAutoScrolling = false;
  let autoScrollRaf = null;

  // Templates for generating rich realistic LLM turns
  const CODE_SNIPPETS = [
    {
      lang: 'typescript',
      code: `<span class="syn-keyword">interface</span> <span class="syn-fn">VirtualNodeCache</span>&lt;T&gt; {\n  <span class="syn-keyword">readonly</span> id: <span class="syn-fn">string</span>;\n  height: <span class="syn-fn">number</span>;\n  domRef?: <span class="syn-fn">HTMLElement</span>;\n}\n\n<span class="syn-keyword">export function</span> <span class="syn-fn">calculatePrefixSums</span>(items: <span class="syn-fn">number</span>[]): <span class="syn-fn">number</span>[] {\n  <span class="syn-keyword">const</span> prefix = [<span class="syn-num">0</span>];\n  <span class="syn-keyword">for</span> (<span class="syn-keyword">let</span> i = <span class="syn-num">0</span>; i &lt; items.length; i++) {\n    prefix.push(prefix[i] + items[i]);\n  }\n  <span class="syn-keyword">return</span> prefix;\n}`
    },
    {
      lang: 'rust',
      code: `<span class="syn-keyword">use</span> std::collections::HashMap;\n\n<span class="syn-keyword">pub struct</span> <span class="syn-fn">GhostSpacerEngine</span> {\n    offsets: <span class="syn-fn">Vec</span>&lt;<span class="syn-fn">f64</span>&gt;,\n    lookup: <span class="syn-fn">HashMap</span>&lt;<span class="syn-fn">u64</span>, <span class="syn-fn">f64</span>&gt;,\n}\n\n<span class="syn-keyword">impl</span> <span class="syn-fn">GhostSpacerEngine</span> {\n    <span class="syn-keyword">pub fn</span> <span class="syn-fn">query_visible_window</span>(&amp;<span class="syn-keyword">self</span>, top: <span class="syn-fn">f64</span>, bottom: <span class="syn-fn">f64</span>) -&gt; (<span class="syn-fn">usize</span>, <span class="syn-fn">usize</span>) {\n        <span class="syn-comment">// O(log N) Binary partition windowing</span>\n        <span class="syn-keyword">let</span> start = <span class="syn-keyword">self</span>.offsets.partition_point(|&amp;y| y &lt; top);\n        <span class="syn-keyword">let</span> end = <span class="syn-keyword">self</span>.offsets.partition_point(|&amp;y| y &lt;= bottom);\n        (start, end)\n    }\n}`
    },
    {
      lang: 'python',
      code: `<span class="syn-keyword">import</span> numpy <span class="syn-keyword">as</span> np\n<span class="syn-keyword">import</span> torch\n\n<span class="syn-keyword">def</span> <span class="syn-fn">compute_attention_weights</span>(q, k, v, mask=None):\n    scores = torch.matmul(q, k.transpose(-<span class="syn-num">2</span>, -<span class="syn-num">1</span>)) / np.sqrt(q.size(-<span class="syn-num">1</span>))\n    <span class="syn-keyword">if</span> mask <span class="syn-keyword">is not</span> None:\n        scores = scores.masked_fill(mask == <span class="syn-num">0</span>, -<span class="syn-num">1e9</span>)\n    p_attn = torch.softmax(scores, dim=-<span class="syn-num">1</span>)\n    <span class="syn-keyword">return</span> torch.matmul(p_attn, v), p_attn`
    }
  ];

  const MATH_SNIPPETS = [
    `$$\\mathcal{L}_{Total} = \\mathbb{E}_{(x, y)} \\left[ -\\sum_{t=1}^T \\log P_{\\theta}(y_t \\mid y_{<t}, x) \\right] + \\beta \\cdot D_{KL}(P_\\theta \\parallel P_{ref})$$`,
    `$$\\text{Speedup}(N) = \\frac{T_{FullDOM}(N)}{T_{Virtualized}(N)} = \\mathcal{O}\\left(\\frac{N}{\\text{ViewportCount}}\\right) \\approx 200\\times$$`,
    `$$\\sigma(z)_j = \\frac{e^{z_j}}{\\sum_{k=1}^K e^{z_k}} \\quad \\text{for } j = 1, \\dots, K$$`
  ];

  const USER_PROMPTS = [
    "How does DOM virtualization eliminate frame drops in 10,000+ message chat threads?",
    "Can you provide the mathematical formulation for KV cache compression in LLMs?",
    "Show me how to optimize CSS layout recalculations and GPU paint bounds.",
    "Explain the difference between ghost spacer DOM detachment and content-visibility: auto.",
    "Provide a benchmark table comparing memory consumption across 1k, 5k, and 10k messages."
  ];

  function generateChatHTML(count) {
    const turns = [];
    for (let i = 0; i < count; i++) {
      const isUser = (i % 2 === 0);
      const turnNum = i + 1;

      if (isUser) {
        const promptText = USER_PROMPTS[(i / 2) % USER_PROMPTS.length];
        turns.push(`
          <article class="chat-message-turn user-turn" data-testid="conversation-turn-${turnNum}" data-message-author-role="user">
            <div class="turn-avatar">U</div>
            <div class="turn-body">
              <div class="turn-author">
                <span>User</span>
                <span class="turn-index-tag">#${turnNum}</span>
              </div>
              <p>${promptText} (Query iteration ${Math.floor(i / 2) + 1})</p>
            </div>
          </article>
        `);
      } else {
        const code = CODE_SNIPPETS[Math.floor(i / 2) % CODE_SNIPPETS.length];
        const math = MATH_SNIPPETS[Math.floor(i / 2) % MATH_SNIPPETS.length];

        turns.push(`
          <article class="chat-message-turn assistant-turn" data-testid="conversation-turn-${turnNum}" data-message-author-role="assistant">
            <div class="turn-avatar">⚡</div>
            <div class="turn-body">
              <div class="turn-author">
                <span>Assistant (GPT-4.5)</span>
                <span class="turn-index-tag">#${turnNum}</span>
              </div>
              <p>Here is the architectural analysis and high-performance implementation for iteration #${turnNum}:</p>
              
              <div class="code-block">
                <div class="code-header">
                  <span>${code.lang.toUpperCase()}</span>
                  <span>Copy code</span>
                </div>
                <pre><code>${code.code}</code></pre>
              </div>

              <div class="math-card">
                <span>${math}</span>
              </div>

              <table class="rich-table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Standard DOM</th>
                    <th>HPruner Virtualized</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Active GPU Textures</td>
                    <td>100% (${turnNum * 12} layers)</td>
                    <td>&lt; 5% (Viewport only)</td>
                  </tr>
                  <tr>
                    <td>Layout Cost</td>
                    <td>Recalculates entire tree</td>
                    <td>Bounded O(1)</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </article>
        `);
      }
    }
    return turns.join('');
  }

  function initDataset(count) {
    chatInner.innerHTML = generateChatHTML(count);
    threadTitle.textContent = `Generated Thread (${count.toLocaleString()} Messages)`;

    if (virtualizer) {
      virtualizer.scanAndRegisterTurns();
      virtualizer.scheduleVirtualize();
    }
    updateTelemetry();
  }

  function setupVirtualizer() {
    virtualizer = new window.HPrunerVirtualizer({
      enabled: true,
      mode: 'progressive',
      overscanBuffer: 650,
      safeStreamingGuard: true,
      autoScrollFix: true
    });

    searchOverlay = new window.HPrunerSearchOverlay(virtualizer);
    hud = new window.HPrunerHUD(virtualizer, searchOverlay);

    virtualizer.onStatsChange((stats) => {
      renderTelemetryStats(stats);
    });
  }

  function updateTelemetry() {
    const totalDOMNodes = document.querySelectorAll('*').length;
    liveDomNodes.textContent = totalDOMNodes.toLocaleString();

    if (virtualizer) {
      renderTelemetryStats(virtualizer.stats);
    }
  }

  function renderTelemetryStats(stats) {
    const fps = stats.fps || 60;
    liveFps.textContent = fps;
    const fpsPct = Math.min(100, Math.max(0, (fps / 60) * 100));
    fpsMeterFill.style.width = `${fpsPct}%`;

    if (fps >= 55) {
      liveFps.style.color = '#10b981';
      fpsMeterFill.style.backgroundColor = '#10b981';
    } else if (fps >= 40) {
      liveFps.style.color = '#f59e0b';
      fpsMeterFill.style.backgroundColor = '#f59e0b';
    } else {
      liveFps.style.color = '#ef4444';
      fpsMeterFill.style.backgroundColor = '#ef4444';
    }

    liveMountedTurns.textContent = `${stats.renderedTurns} / ${stats.totalTurns}`;
    const prunedCount = stats.totalTurns - stats.renderedTurns;
    const prunedPct = stats.totalTurns > 0 ? Math.round((prunedCount / stats.totalTurns) * 100) : 0;
    livePrunedPct.textContent = `${prunedPct}% pruned`;
    liveRamSaved.textContent = `${stats.estimatedMemorySavedMB} MB`;

    // Recalculate physical DOM node count
    const totalDOMNodes = document.querySelectorAll('*').length;
    liveDomNodes.textContent = totalDOMNodes.toLocaleString();
  }

  // Engine Mode Switcher
  engineBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      engineBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const mode = btn.getAttribute('data-mode');
      const enabled = (mode !== 'off');

      virtualizer.setOptions({ mode, enabled });

      if (mode === 'off') {
        viewportStatus.textContent = 'Full DOM (Unpruned)';
        viewportStatus.style.borderColor = 'rgba(239, 68, 68, 0.4)';
        viewportStatus.style.color = '#ef4444';
      } else {
        viewportStatus.textContent = `Virtualized (${mode.toUpperCase()})`;
        viewportStatus.style.borderColor = 'rgba(16, 185, 129, 0.4)';
        viewportStatus.style.color = '#10b981';
      }

      updateTelemetry();
    });
  });

  // Dataset Generator button
  btnGenerate.addEventListener('click', () => {
    const count = parseInt(msgCountSelect.value, 10);
    btnGenerate.disabled = true;
    btnGenerate.innerHTML = '⚡ Generating...';

    setTimeout(() => {
      initDataset(count);
      btnGenerate.disabled = false;
      btnGenerate.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
        Generate Dataset
      `;
    }, 50);
  });

  // Stress auto-scroll
  btnStressScroll.addEventListener('click', () => {
    if (isAutoScrolling) {
      isAutoScrolling = false;
      cancelAnimationFrame(autoScrollRaf);
      btnStressScroll.innerHTML = '<span>🚀 Stress Auto-Scroll</span>';
      return;
    }

    isAutoScrolling = true;
    btnStressScroll.innerHTML = '<span>⏹️ Stop Scroll</span>';

    let direction = 1;
    const speed = 25; // px per frame

    function scrollStep() {
      if (!isAutoScrolling) return;
      chatContainer.scrollTop += speed * direction;

      if (chatContainer.scrollTop + chatContainer.clientHeight >= chatContainer.scrollHeight - 10) {
        direction = -1;
      } else if (chatContainer.scrollTop <= 10) {
        direction = 1;
      }

      autoScrollRaf = requestAnimationFrame(scrollStep);
    }
    autoScrollRaf = requestAnimationFrame(scrollStep);
  });

  // Streaming assistant simulation
  btnSimulateStream.addEventListener('click', () => {
    chatContainer.scrollTop = chatContainer.scrollHeight;
    
    const turnNum = (virtualizer.turns.length || 0) + 1;
    const streamDiv = document.createElement('article');
    streamDiv.className = 'chat-message-turn assistant-turn result-streaming';
    streamDiv.setAttribute('data-testid', `conversation-turn-${turnNum}`);
    streamDiv.setAttribute('data-message-author-role', 'assistant');
    streamDiv.setAttribute('data-is-streaming', 'true');

    streamDiv.innerHTML = `
      <div class="turn-avatar">⚡</div>
      <div class="turn-body">
        <div class="turn-author">
          <span>Assistant (Streaming Token Test)</span>
          <span class="turn-index-tag">#${turnNum} (Live)</span>
        </div>
        <p class="stream-text"></p>
      </div>
    `;

    chatInner.appendChild(streamDiv);
    const textTarget = streamDiv.querySelector('.stream-text');

    const sampleTokens = "Streaming response token demonstration. The HPruner safeStreamingGuard guarantees this active turn will NEVER be unmounted or pruned while tokens are being generated by the model. Real-time DOM mutations are processed seamlessly with 60 FPS fluidity!".split(' ');
    
    let tokenIdx = 0;
    const interval = setInterval(() => {
      if (tokenIdx < sampleTokens.length) {
        textTarget.textContent += sampleTokens[tokenIdx] + ' ';
        chatContainer.scrollTop = chatContainer.scrollHeight;
        tokenIdx++;
      } else {
        clearInterval(interval);
        streamDiv.classList.remove('result-streaming');
        streamDiv.removeAttribute('data-is-streaming');
      }
    }, 45);
  });

  btnTriggerSearch.addEventListener('click', () => {
    if (searchOverlay) searchOverlay.open();
  });

  btnScrollBottom.addEventListener('click', () => {
    chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
  });

  // Setup on page load
  window.addEventListener('DOMContentLoaded', () => {
    initDataset(1000);
    setupVirtualizer();
    setInterval(updateTelemetry, 1000);
  });
})();
