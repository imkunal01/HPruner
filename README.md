# ⚡ HPruner - GPT History DOM Virtualizer & Pruning Extension

> **Render only what fits on the physical screen, and fake the rest.**

**HPruner** is a high-performance Chromium & Firefox (Manifest V3) browser extension that brings zero-lag DOM Virtualization, memory pruning, and ghost spacing to ChatGPT (`chatgpt.com`, `chat.openai.com`), Claude (`claude.ai`), and long-scroll web chat interfaces.

It prevents browser tab freezes, memory crashes, and frame drops on massive conversation histories (100+ to 10,000+ message turns), dropping active DOM nodes by **up to 95%** and keeping scroll performance locked at **60 FPS**.

---

## 🚀 Key Features

* **⚡ True Subtree Detachment & Ghost Spacing:** Automatically unmounts off-screen heavy message nodes (syntax-highlighted code blocks, KaTeX math SVGs, Markdown tables, images) and replaces them with lightweight ghost spacer shells matching exact physical pixel heights.
* **📏 Dynamic Height Cache & ResizeObserver:** Measures and caches exact layout dimensions before detaching, ensuring zero layout shift and a 100% natural, proportional scrollbar.
* **🛡️ Safe Streaming Guard:** Automatically detects active streaming assistant responses (`[data-is-streaming="true"]`, `.result-streaming`, active generation mutations) and keeps them fully mounted and responsive.
* **🔍 In-Memory Thread Search (`Ctrl+Shift+F`):** Searches the complete conversation history in memory even when off-screen messages are unmounted from the DOM, with instant jump-to-turn and smooth scroll navigation.
* **📊 Floating In-Page Performance HUD:** Minimalist draggable glassmorphism pill displaying live scroll FPS, mounted vs. total nodes, and estimated RAM saved.
* **🎛️ 4 Pruning Modes:**
  * **Ultra Prune** (250px overscan buffer — maximum memory reduction for 1,000+ message threads)
  * **Balanced** (550px overscan buffer — buttery smooth 60 FPS scrolling)
  * **Eco** (CSS `content-visibility: auto` + `contain-intrinsic-size`)
  * **Off / Passthrough** (Instantly restores full DOM)
* **📦 Markdown & JSON Thread Export:** One-click backup of entire conversations with timestamps and role tags.
* **🧪 Self-Contained 10,000 Message Benchmark Suite:** Includes a standalone test harness (`demo/index.html`) to benchmark performance under extreme loads.

---

## 🛠️ How to Install in Chrome / Edge / Brave

1. Clone or download this repository:
   ```bash
   git clone https://github.com/imkunal01/Gpt_History_Prune.git
   ```
2. Open your browser and navigate to the Extensions management page:
   * **Chrome / Brave:** `chrome://extensions/`
   * **Edge:** `edge://extensions/`
3. Enable **Developer mode** (toggle in the top right corner).
4. Click **"Load unpacked"**.
5. Select the `Gpt_History_Prune` folder containing `manifest.json`.
6. Open [ChatGPT](https://chatgpt.com) — the HPruner floating HUD and virtualization will automatically activate!

---

## 🧪 Testing with the Benchmark Harness

You can test HPruner with up to **10,000 simulated messages** without opening ChatGPT:

1. Open `demo/index.html` in your browser (or click "Test Harness" in the extension popup).
2. Choose your dataset size (e.g. `1,000 Messages` or `10,000 Messages`).
3. Click **"Stress Auto-Scroll"** and observe the live telemetry:
   * **Full DOM:** 100,000+ DOM nodes, high RAM consumption, stuttering FPS.
   * **HPruner Virtualized:** ~30 to 80 active nodes, ~20–100 MB RAM saved, constant **60 FPS**.
4. Press `Ctrl+Shift+F` to test the in-memory search across all turns.

---

## 📐 Architecture & The 3 Pillars

```
┌────────────────────────────────────────────────────────┐
│ Top Ghost Spacer - Height: Sum(h[0] .. h[997])         │
├────────────────────────────────────────────────────────┤  ◄── Overscan Buffer Top (~250-550px)
│ [Message #997] (Mounted buffer)                        │
├────────────────────────────────────────────────────────┤  ◄── Viewport Top (Scroll Offset)
│ [Message #998] (Active & Interactive)                  │
│ [Message #999] (Active & Interactive)                  │  Visible Window
│ [Message #1000] (Active & Interactive)                 │  (~10–20 DOM nodes)
├────────────────────────────────────────────────────────┤  ◄── Viewport Bottom
│ [Message #1001] (Mounted buffer)                       │
├────────────────────────────────────────────────────────┤  ◄── Overscan Buffer Bottom (~250-550px)
│ Bottom Ghost Spacer - Height: Sum(h[1002]..h[N])       │
└────────────────────────────────────────────────────────┘
```

1. **Viewport Boundary Tracking:** Passive scroll listeners with `requestAnimationFrame` window calculation.
2. **Selective Mounting & Height Preservation:** `ResizeObserver` measures exact block heights; off-screen turns swap into a lightweight ghost placeholder with `contain: strict` to release GPU layers and style trees.
3. **Scroll Anchoring:** Synchronously compensates `scrollTop` on upward scrolling if dynamic height variations occur.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Ctrl+Shift+F` (Mac: `Cmd+Shift+F`) | Open in-memory full-thread search |
| `Enter` / `Shift+Enter` | Navigate next / previous search match |
| `Esc` | Close search modal |

---

## 📄 License
MIT License. Built for seamless and lightning-fast AI conversations.
