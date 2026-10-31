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

// Extract current active workflow file name
function getCurrentWorkflowName() {
  try {
    if (document.title) {
      let title = document.title
        .replace(/^[*•\s]+/, "")
        .replace(/\s*-\s*ComfyUI.*$/i, "")
        .trim();
      if (title) {
        title = title.replace(/\s*\(\d+\)$/, "").trim();
        if (title && title.toLowerCase() !== "comfyui") {
          return title.endsWith(".json") ? title : `${title}.json`;
        }
      }
    }
    const tabEl = document.querySelector(".comfyui-workflow-tab.active, [data-testid='workflow-tab-active']");
    if (tabEl && tabEl.textContent.trim()) {
      let name = tabEl.textContent.trim().replace(/^[*•\s]+/, "").trim();
      name = name.replace(/\s*\(\d+\)$/, "").trim();
      if (name) return name.endsWith(".json") ? name : `${name}.json`;
    }
  } catch (e) {}
  return "workflow.json";
}

class SidebarVersionIntegration {
  constructor() {
    this.isProcessing = false;
    this.isHistoryExpanded = false;
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
    // NEVER touch PrimeVue tree or file list DOM below!
    this.injectQuickCommitBar(searchInput, panel);
  }

  injectQuickCommitBar(searchInput, panel) {
    let commitBar = panel.querySelector("#wfg-sidebar-commit-bar");
    const currentName = getCurrentWorkflowName();

    if (commitBar) {
      const nameEl = commitBar.querySelector("#wfg-current-file-name");
      if (nameEl && nameEl.textContent !== currentName) {
        nameEl.textContent = currentName;
        nameEl.title = currentName;
        // If history is open, refresh for new active file
        if (this.isHistoryExpanded) {
          this.loadHistoryList(commitBar, currentName);
        }
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
          <span class="wfg-sidebar-branch-tag" id="wfg-branch-tag">快照版本</span>
          <button id="wfg-history-toggle-btn" class="wfg-sidebar-history-toggle-btn" title="查看该工作流历史版本">
            📜 历史 <span id="wfg-history-arrow">▾</span>
          </button>
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
      <div id="wfg-sidebar-history-panel" class="wfg-sidebar-history-panel">
        <div style="font-size: 11px; color: #64748b; padding: 4px; text-align: center;">点击展开历史版本</div>
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
    const historyBtn = commitBar.querySelector("#wfg-history-toggle-btn");
    const historyPanel = commitBar.querySelector("#wfg-sidebar-history-panel");

    // Toggle history view
    historyBtn.onclick = () => {
      this.isHistoryExpanded = !this.isHistoryExpanded;
      if (this.isHistoryExpanded) {
        historyBtn.classList.add("active");
        historyPanel.classList.add("expanded");
        commitBar.querySelector("#wfg-history-arrow").textContent = "▴";
        this.loadHistoryList(commitBar, getCurrentWorkflowName());
      } else {
        historyBtn.classList.remove("active");
        historyPanel.classList.remove("expanded");
        commitBar.querySelector("#wfg-history-arrow").textContent = "▾";
      }
    };

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

        showToast(`✔ 已保存版本 [${data.commit_hash}]: ${msg}`);
        input.value = "";

        // If history is open, refresh it immediately
        if (this.isHistoryExpanded) {
          this.loadHistoryList(commitBar, fileName);
        }
      } catch (e) {
        alert(`保存版本失败: ${e.message}`);
      } finally {
        commitBtn.disabled = false;
        commitBtn.textContent = "✔ 保存";
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
    const historyPanel = commitBar.querySelector("#wfg-sidebar-history-panel");
    if (!historyPanel) return;

    historyPanel.innerHTML = `<div style="font-size: 11px; color: #64748b; padding: 6px; text-align: center;">正在读取历史版本...</div>`;

    try {
      const res = await fetch(`/workflow-git/history?file=${encodeURIComponent(fileName)}&limit=50`);
      const data = await res.json();

      if (!data.success || !data.history.length) {
        historyPanel.innerHTML = `<div style="font-size: 11px; color: #64748b; padding: 6px; text-align: center;">[${fileName}] 暂无历史版本</div>`;
        return;
      }

      historyPanel.innerHTML = "";
      data.history.forEach((commit) => {
        const node = document.createElement("div");
        node.className = "wfg-history-node";
        node.innerHTML = `
          <div class="wfg-history-node-left">
            <div class="wfg-history-node-msg" title="${commit.message}">${commit.message}</div>
            <div class="wfg-history-node-meta">
              <span class="wfg-history-node-hash">#${commit.short_hash}</span>
              <span>${commit.date ? commit.date.split(" ")[0] : ""}</span>
            </div>
          </div>
          <div class="wfg-history-node-actions">
            <button class="wfg-history-restore-btn" title="将此版本载入当前画布">
              载入
            </button>
            <button class="wfg-history-delete-btn" title="删除此历史版本">
              🗑️
            </button>
          </div>
        `;

        // Restore button: loads graph into CURRENT workflow without opening Unsaved tab
        node.querySelector(".wfg-history-restore-btn").onclick = async (e) => {
          e.stopPropagation();
          if (!confirm(`确定要将 [${fileName}] 恢复到版本 #${commit.short_hash} ("${commit.message}") 吗？当前画布改动将被覆盖。`)) {
            return;
          }

          try {
            const checkoutRes = await fetch(`/workflow-git/checkout?hash=${commit.short_hash}&file=${encodeURIComponent(fileName)}`);
            const checkoutData = await checkoutRes.json();
            if (!checkoutData.success) throw new Error(checkoutData.error);

            if (checkoutData.workflow) {
              // Pass fileName as 4th parameter so ComfyUI reuses active workflow tab!
              try {
                await app.loadGraphData(checkoutData.workflow, true, true, fileName);
              } catch (loadErr) {
                // Fallback direct configure
                if (app.graph && typeof app.graph.configure === "function") {
                  app.graph.configure(checkoutData.workflow);
                } else {
                  app.loadGraphData(checkoutData.workflow);
                }
              }
              showToast(`✔ 已载入 [${fileName}] 版本 (#${commit.short_hash})`);
            }
          } catch (err) {
            alert(`载入失败: ${err.message}`);
          }
        };

        // Delete button: deletes the specific snapshot
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
            // Refresh history list
            this.loadHistoryList(commitBar, fileName);
          } catch (err) {
            alert(`删除失败: ${err.message}`);
          }
        };

        historyPanel.appendChild(node);
      });
    } catch (e) {
      historyPanel.innerHTML = `<div style="font-size: 11px; color: #ef4444; padding: 6px; text-align: center;">读取失败: ${e.message}</div>`;
    }
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
