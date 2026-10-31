import { app } from "../../../scripts/app.js";

// Helper: inject css
function injectCSS() {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("../css/workflow-git.css", import.meta.url).href;
  document.head.appendChild(link);
}

// Toast notification helper
function showToast(message, duration = 3000) {
  let toast = document.querySelector(".workflow-git-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "workflow-git-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("active");
  setTimeout(() => toast.classList.remove("active"), duration);
}

let lastKnownWorkflowName = "最简工作流.json";

// Validate and clean workflow names, strictly filtering out execution progress strings
function cleanWorkflowName(raw) {
  if (!raw) return null;
  let name = raw.trim();

  // Remove dirty dots, stars, spaces
  name = name.replace(/^[*•\s]+/, "").replace(/[*•\s]+$/, "").trim();

  // Filter out ComfyUI execution progress like "[57%][70%] KSampler" or "Queue: 1"
  if (/\[\s*\d+%\s*\]/i.test(name)) return null;
  if (/^\[.*%\]/i.test(name)) return null;
  if (/^ksampler/i.test(name) || /^queue/i.test(name)) return null;
  if (!name || name.toLowerCase() === "comfyui") return null;

  if (!name.endsWith(".json")) {
    name = `${name}.json`;
  }
  return name;
}

// Extract current active workflow file name with tab-first priority
function getCurrentWorkflowName() {
  try {
    // 1. Prioritize PrimeVue active workflow tab: .p-togglebutton-checked .workflow-tab
    const activeTab = document.querySelector(".p-togglebutton-checked .workflow-tab");
    if (activeTab) {
      const span = activeTab.querySelector("span");
      const text = span ? span.textContent : activeTab.textContent;
      const parsed = cleanWorkflowName(text);
      if (parsed) {
        lastKnownWorkflowName = parsed;
        return parsed;
      }
    }

    // 2. Any active tab or workflow tab element
    const tabEls = document.querySelectorAll(".workflow-tab, [class*='workflow-tab']");
    for (const el of tabEls) {
      if (el.closest(".p-togglebutton-checked") || el.classList.contains("active")) {
        const span = el.querySelector("span") || el;
        const parsed = cleanWorkflowName(span.textContent);
        if (parsed) {
          lastKnownWorkflowName = parsed;
          return parsed;
        }
      }
    }

    // 3. Document title fallback ONLY IF it's not a progress indicator
    if (document.title) {
      let title = document.title.replace(/\s*-\s*ComfyUI.*$/i, "").trim();
      const parsed = cleanWorkflowName(title);
      if (parsed) {
        lastKnownWorkflowName = parsed;
        return parsed;
      }
    }
  } catch (e) {}

  return lastKnownWorkflowName || "workflow.json";
}

// Compute semantic graph fingerprint ignoring viewport pan/zoom (ds) and volatile canvas state
function getGraphFingerprint(graph) {
  if (!graph || typeof graph !== "object") return "";
  try {
    const copy = JSON.parse(JSON.stringify(graph));
    // Strip canvas viewport offset/scale so zooming/panning doesn't count as dirty
    if (copy.extra && copy.extra.ds) {
      delete copy.extra.ds;
    }
    if (copy.extra && copy.extra.ue_properties) {
      delete copy.extra.ue_properties;
    }
    // Normalize nodes ordering by ID for deterministic comparison
    if (Array.isArray(copy.nodes)) {
      copy.nodes.sort((a, b) => {
        const idA = typeof a.id === "number" ? a.id : String(a.id || "");
        const idB = typeof b.id === "number" ? b.id : String(b.id || "");
        return idA > idB ? 1 : -1;
      });
    }
    return JSON.stringify(copy);
  } catch (e) {
    return "";
  }
}

class SidebarVersionIntegration {
  constructor() {
    this.isProcessing = false;
    this.currentWorkflowName = "";
    this.activeVersionHash = "";
    this.lastCleanFingerprint = "";
    this.isDirty = false;
    this.currentPage = 1;
    this.pageSize = 5;
    this.allHistoryItems = [];
    this.init();
  }

  init() {
    // Listen for tab navigation clicks to inject UI when Workflows drawer opens
    document.addEventListener("click", (e) => {
      const target = e.target.closest("button, [class*='tab'], [class*='icon'], [class*='nav'], [class*='sidebar']");
      if (target) {
        setTimeout(() => this.safeInject(), 150);
        setTimeout(() => this.safeInject(), 600);
      }
    });

    // Check on startup
    setTimeout(() => this.safeInject(), 800);
    setTimeout(() => this.safeInject(), 2000);

    // Periodically check for semantic modifications every 800ms
    setInterval(() => {
      this.checkDirtyState();
    }, 800);
  }

  checkDirtyState() {
    if (!app.graph || this.isProcessing) return;
    try {
      const currentFingerprint = getGraphFingerprint(app.graph.serialize());
      if (!currentFingerprint) return;

      if (!this.lastCleanFingerprint) {
        this.lastCleanFingerprint = currentFingerprint;
        this.isDirty = false;
        this.updateDirtyIndicator();
        return;
      }

      const dirty = currentFingerprint !== this.lastCleanFingerprint;
      if (dirty !== this.isDirty) {
        this.isDirty = dirty;
        this.updateDirtyIndicator();
      }
    } catch (e) {}
  }

  updateDirtyIndicator() {
    const badgeEl = document.querySelector("#wfg-version-badge");
    const dirtyEl = document.querySelector("#wfg-dirty-pill");
    const commitBtn = document.querySelector("#wfg-quick-commit-btn");

    if (badgeEl) {
      badgeEl.textContent = this.activeVersionHash ? `#${this.activeVersionHash}` : "无快照";
      badgeEl.title = this.activeVersionHash ? `当前基底版本: #${this.activeVersionHash}` : "当前尚未保存快照";
    }

    if (dirtyEl) {
      if (this.isDirty) {
        dirtyEl.className = "wfg-dirty-pill dirty";
        dirtyEl.innerHTML = `● 已修改`;
        dirtyEl.title = "当前画布与快照版本不一致，有改动可提交";
      } else {
        dirtyEl.className = "wfg-dirty-pill clean";
        dirtyEl.innerHTML = `✔ 干净`;
        dirtyEl.title = "当前画布与该快照版本完全一致";
      }
    }

    if (commitBtn) {
      if (this.isDirty) {
        commitBtn.classList.add("has-changes");
        commitBtn.textContent = "✔ 保存修改";
      } else {
        commitBtn.classList.remove("has-changes");
        commitBtn.textContent = "✔ 保存";
      }
    }
  }

  safeInject() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      this.doInject();
    } catch (e) {
      console.warn("[WorkflowVersion] Safe inject error:", e);
    } finally {
      this.isProcessing = false;
    }
  }

  doInject() {
    // 1. Find the search input in Workflows drawer
    const inputs = document.querySelectorAll("input");
    let searchInput = null;
    for (const input of inputs) {
      const ph = (input.placeholder || "").toLowerCase();
      if (ph.includes("工作流") || ph.includes("workflow")) {
        searchInput = input;
        break;
      }
    }

    if (!searchInput) return;

    // Find enclosing drawer panel
    const panel = searchInput.closest("[class*='content'], [class*='panel'], [class*='sidebar']") || searchInput.parentElement?.parentElement;
    if (!panel) return;

    // 2. Inject Quick Commit & History Bar strictly into its own container
    this.injectQuickCommitBar(searchInput, panel);
  }

  async syncActiveWorkflowMetadata(fileName, commitBar) {
    this.currentWorkflowName = fileName;
    this.currentPage = 1;
    try {
      const res = await fetch(`/workflow-git/history?file=${encodeURIComponent(fileName)}&limit=100`);
      const data = await res.json();
      this.allHistoryItems = (data.success && data.history) ? data.history : [];
      if (this.allHistoryItems.length > 0) {
        this.activeVersionHash = this.allHistoryItems[0].short_hash;
      } else {
        this.activeVersionHash = "";
      }
    } catch (e) {
      this.allHistoryItems = [];
      this.activeVersionHash = "";
    }

    if (app.graph) {
      this.lastCleanFingerprint = getGraphFingerprint(app.graph.serialize());
    }
    this.isDirty = false;
    this.updateDirtyIndicator();

    if (commitBar) {
      this.renderHistoryPage(commitBar, fileName);
    }
  }

  injectQuickCommitBar(searchInput, panel) {
    let commitBar = panel.querySelector("#wfg-sidebar-commit-bar");
    const currentName = getCurrentWorkflowName();

    if (commitBar) {
      const nameEl = commitBar.querySelector("#wfg-current-file-name");
      if (nameEl && nameEl.textContent !== currentName) {
        nameEl.textContent = currentName;
        nameEl.title = currentName;
        this.syncActiveWorkflowMetadata(currentName, commitBar);
      }
      return;
    }

    commitBar = document.createElement("div");
    commitBar.id = "wfg-sidebar-commit-bar";
    commitBar.className = "wfg-sidebar-commit-container";

    commitBar.innerHTML = `
      <div class="wfg-sidebar-commit-header">
        <div class="wfg-sidebar-file-badge">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <circle cx="18" cy="18" r="3"></circle>
            <circle cx="6" cy="6" r="3"></circle>
            <path d="M13 6h3a2 2 0 0 1 2 2v7"></path>
            <line x1="6" y1="9" x2="6" y2="21"></line>
          </svg>
          <span id="wfg-current-file-name" title="${currentName}">${currentName}</span>
        </div>
        <div class="wfg-sidebar-header-right">
          <span class="wfg-version-badge" id="wfg-version-badge">版本</span>
          <span class="wfg-dirty-pill clean" id="wfg-dirty-pill">✔ 干净</span>
        </div>
      </div>
      <div class="wfg-sidebar-input-row">
        <input
          type="text"
          id="wfg-quick-msg"
          class="wfg-sidebar-commit-input"
          placeholder="版本修改说明 (Enter 保存)..."
        />
        <button id="wfg-quick-commit-btn" class="wfg-sidebar-commit-btn" title="保存当前工作流新版本">
          ✔ 保存
        </button>
      </div>
      <div id="wfg-sidebar-history-container" class="wfg-sidebar-history-container">
        <div id="wfg-sidebar-history-list" class="wfg-sidebar-history-list"></div>
        <div id="wfg-sidebar-pagination" class="wfg-sidebar-pagination">
          <button id="wfg-page-prev" class="wfg-page-btn" title="上一页">◀ 上一页</button>
          <span id="wfg-page-info" class="wfg-page-info">1 / 1</span>
          <button id="wfg-page-next" class="wfg-page-btn" title="下一页">下一页 ▶</button>
        </div>
      </div>
    `;

    // Place right below search box
    const anchor = searchInput.closest(".search-container, .input-container, [class*='search']") || searchInput.parentElement;
    if (anchor && anchor.parentElement) {
      anchor.parentElement.insertBefore(commitBar, anchor.nextSibling);
    } else {
      panel.insertBefore(commitBar, panel.firstChild);
    }

    const input = commitBar.querySelector("#wfg-quick-msg");
    const commitBtn = commitBar.querySelector("#wfg-quick-commit-btn");
    const prevBtn = commitBar.querySelector("#wfg-page-prev");
    const nextBtn = commitBar.querySelector("#wfg-page-next");

    // Hook pagination buttons
    prevBtn.onclick = () => {
      if (this.currentPage > 1) {
        this.currentPage--;
        this.renderHistoryPage(commitBar, getCurrentWorkflowName());
      }
    };

    nextBtn.onclick = () => {
      const totalPages = Math.max(1, Math.ceil(this.allHistoryItems.length / this.pageSize));
      if (this.currentPage < totalPages) {
        this.currentPage++;
        this.renderHistoryPage(commitBar, getCurrentWorkflowName());
      }
    };

    // Initialize version metadata and render initial list
    this.syncActiveWorkflowMetadata(currentName, commitBar);

    // Save snapshot logic
    const doCommit = async () => {
      const msg = input.value.trim();
      if (!msg) {
        input.focus();
        return;
      }
      const fileName = getCurrentWorkflowName();
      try {
        commitBtn.disabled = true;
        commitBtn.textContent = "保存中...";

        const workflowData = app.graph.serialize();
        const res = await fetch("/workflow-git/commit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            file_name: fileName,
            message: msg,
            workflow: workflowData
          })
        });

        const data = await res.json();
        if (!data.success) throw new Error(data.error);

        this.activeVersionHash = data.commit_hash;
        this.lastCleanFingerprint = getGraphFingerprint(workflowData);
        this.isDirty = false;
        this.currentPage = 1;
        this.updateDirtyIndicator();

        showToast(`✔ 已保存版本 [#${data.commit_hash}]: ${msg}`);
        input.value = "";

        // Reload history list fresh from server
        this.loadHistoryList(commitBar, fileName);
      } catch (e) {
        alert(`保存版本失败: ${e.message}`);
      } finally {
        commitBtn.disabled = false;
        this.updateDirtyIndicator();
      }
    };

    commitBtn.onclick = doCommit;
    input.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        doCommit();
      }
    };
  }

  async loadHistoryList(commitBar, fileName) {
    try {
      const res = await fetch(`/workflow-git/history?file=${encodeURIComponent(fileName)}&limit=100`);
      const data = await res.json();
      this.allHistoryItems = (data.success && data.history) ? data.history : [];
    } catch (e) {
      this.allHistoryItems = [];
    }
    this.renderHistoryPage(commitBar, fileName);
  }

  renderHistoryPage(commitBar, fileName) {
    const listEl = commitBar.querySelector("#wfg-sidebar-history-list");
    const pageInfo = commitBar.querySelector("#wfg-page-info");
    const prevBtn = commitBar.querySelector("#wfg-page-prev");
    const nextBtn = commitBar.querySelector("#wfg-page-next");
    const paginationEl = commitBar.querySelector("#wfg-sidebar-pagination");

    if (!listEl) return;

    const totalCount = this.allHistoryItems.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / this.pageSize));

    if (this.currentPage > totalPages) this.currentPage = totalPages;
    if (this.currentPage < 1) this.currentPage = 1;

    // Update pagination controls
    if (pageInfo) {
      pageInfo.textContent = `${this.currentPage} / ${totalPages} (${totalCount}条)`;
    }
    if (prevBtn) prevBtn.disabled = this.currentPage <= 1;
    if (nextBtn) nextBtn.disabled = this.currentPage >= totalPages;

    if (paginationEl) {
      paginationEl.style.display = totalCount > 0 ? "flex" : "none";
    }

    if (totalCount === 0) {
      listEl.innerHTML = `<div style="font-size: 11px; color: #64748b; padding: 8px; text-align: center;">[${fileName}] 暂无历史版本</div>`;
      return;
    }

    const startIndex = (this.currentPage - 1) * this.pageSize;
    const pageItems = this.allHistoryItems.slice(startIndex, startIndex + this.pageSize);

    listEl.innerHTML = "";
    pageItems.forEach((commit) => {
      const isCurrentActive = commit.short_hash === this.activeVersionHash;
      const node = document.createElement("div");
      node.className = `wfg-history-node ${isCurrentActive ? "is-active" : ""}`;
      node.innerHTML = `
        <div class="wfg-history-node-left">
          <div class="wfg-history-node-msg" title="${commit.message}">${commit.message}</div>
          <div class="wfg-history-node-meta">
            <span class="wfg-history-node-hash">#${commit.short_hash}</span>
            ${isCurrentActive ? `<span class="wfg-active-tag">当前基底</span>` : ""}
            <span>${commit.date ? commit.date.split(" ")[0] : ""}</span>
          </div>
        </div>
        <div class="wfg-history-node-actions">
          <button class="wfg-history-restore-btn ${isCurrentActive && !this.isDirty ? "current" : ""}" title="将此版本载入当前画布">
            ${isCurrentActive ? (this.isDirty ? "还原" : "当前") : "载入"}
          </button>
          <button class="wfg-history-delete-btn" title="删除此历史版本">
            🗑️
          </button>
        </div>
      `;

      // Restore button
      node.querySelector(".wfg-history-restore-btn").onclick = async (e) => {
        e.stopPropagation();
        if (isCurrentActive && !this.isDirty) {
          showToast(`当前画布已经是该版本 (#${commit.short_hash})`);
          return;
        }

        if (!confirm(`确定要将 [${fileName}] 恢复到版本 #${commit.short_hash} ("${commit.message}") 吗？当前画布改动将被覆盖。`)) {
          return;
        }

        try {
          this.isProcessing = true;
          const checkoutRes = await fetch(`/workflow-git/checkout?hash=${commit.short_hash}&file=${encodeURIComponent(fileName)}`);
          const checkoutData = await checkoutRes.json();
          if (!checkoutData.success) throw new Error(checkoutData.error);

          if (checkoutData.workflow) {
            try {
              await app.loadGraphData(checkoutData.workflow, true, true, fileName);
            } catch (loadErr) {
              if (app.graph && typeof app.graph.configure === "function") {
                app.graph.configure(checkoutData.workflow);
              } else {
                app.loadGraphData(checkoutData.workflow);
              }
            }

            this.activeVersionHash = commit.short_hash;

            // Wait 350ms for canvas to stabilize, then capture clean baseline
            setTimeout(() => {
              if (app.graph) {
                this.lastCleanFingerprint = getGraphFingerprint(app.graph.serialize());
              } else {
                this.lastCleanFingerprint = getGraphFingerprint(checkoutData.workflow);
              }
              this.isDirty = false;
              this.isProcessing = false;
              this.updateDirtyIndicator();
              this.renderHistoryPage(commitBar, fileName);
            }, 350);

            showToast(`✔ 已载入 [${fileName}] 版本 (#${commit.short_hash})`);
          }
        } catch (err) {
          this.isProcessing = false;
          alert(`载入失败: ${err.message}`);
        }
      };

      // Delete button
      node.querySelector(".wfg-history-delete-btn").onclick = async (e) => {
        e.stopPropagation();
        if (!confirm(`确定要删除历史版本 #${commit.short_hash} ("${commit.message}") 吗？此操作无法撤销。`)) {
          return;
        }

        try {
          const delRes = await fetch("/workflow-git/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              file_name: fileName,
              hash: commit.short_hash
            })
          });
          const delData = await delRes.json();
          if (!delData.success) throw new Error(delData.error || "删除失败");

          showToast(`🗑️ 已删除版本 #${commit.short_hash}`);
          if (this.activeVersionHash === commit.short_hash) {
            this.activeVersionHash = "";
            this.updateDirtyIndicator();
          }
          this.loadHistoryList(commitBar, fileName);
        } catch (err) {
          alert(`删除失败: ${err.message}`);
        }
      };

      listEl.appendChild(node);
    });
  }
}

// Register ComfyUI Extension
app.registerExtension({
  name: "comfyui.workflow.version",
  async setup() {
    injectCSS();

    // Start lightweight sidebar integrator
    new SidebarVersionIntegration();

    // Global shortcut Alt + G focuses version note input
    window.addEventListener("keydown", (e) => {
      if (e.altKey && (e.key === "g" || e.key === "G")) {
        e.preventDefault();
        const input = document.querySelector("#wfg-quick-msg");
        if (input) {
          input.focus();
          input.select();
        } else {
          showToast("请先点击左侧【工作流】抽屉打开面板~");
        }
      }
    });

    console.log("[WorkflowVersion] Lightweight Version Integration initialized cleanly!");
  }
});
