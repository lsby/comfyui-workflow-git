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

class SidebarGitIntegration {
  constructor() {
    this.isProcessing = false;
    this.expandedFiles = new Set();
    this.init();
  }

  init() {
    // 1. Listen for user clicks on sidebar navigation icons (safe and lightweight)
    document.addEventListener("click", (e) => {
      const target = e.target.closest("button, [class*='tab'], [class*='icon'], [class*='nav'], [class*='sidebar']");
      if (target) {
        setTimeout(() => this.safeInject(), 150);
        setTimeout(() => this.safeInject(), 500);
      }
    });

    // 2. Gentle interval poll (never loops, strictly protected by isProcessing)
    setInterval(() => {
      this.safeInject();
    }, 2000);

    // Initial inject attempt
    setTimeout(() => this.safeInject(), 500);
    setTimeout(() => this.safeInject(), 1500);
  }

  safeInject() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      this.doInject();
    } catch (e) {
      console.warn("[WorkflowGit] Safe inject error:", e);
    } finally {
      this.isProcessing = false;
    }
  }

  doInject() {
    // Find workflow search input
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

    // Find the enclosing drawer/panel
    const panel = searchInput.closest("[class*='content'], [class*='panel'], [class*='sidebar']") || searchInput.parentElement?.parentElement;
    if (!panel) return;

    // 1. Inject Quick Commit Bar
    this.injectQuickCommitBar(searchInput, panel);

    // 2. Inject file badges strictly inside this drawer panel
    this.injectFileBadges(panel);
  }

  injectQuickCommitBar(searchInput, panel) {
    if (panel.querySelector("#wfg-sidebar-commit-bar")) {
      const nameEl = panel.querySelector("#wfg-current-file-name");
      if (nameEl) nameEl.textContent = getCurrentWorkflowName();
      return;
    }

    const commitBar = document.createElement("div");
    commitBar.id = "wfg-sidebar-commit-bar";
    commitBar.className = "wfg-sidebar-commit-container";
    const currentName = getCurrentWorkflowName();

    commitBar.innerHTML = `
      <div class="wfg-sidebar-commit-header">
        <div class="wfg-sidebar-current-file">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <circle cx="18" cy="18" r="3"></circle>
            <circle cx="6" cy="6" r="3"></circle>
            <path d="M13 6h3a2 2 0 0 1 2 2v7"></path>
            <line x1="6" y1="9" x2="6" y2="21"></line>
          </svg>
          <span id="wfg-current-file-name" title="${currentName}">${currentName}</span>
        </div>
        <span class="wfg-sidebar-branch-tag" id="wfg-branch-tag">Git</span>
      </div>
      <div class="wfg-sidebar-input-row">
        <input
          type="text"
          id="wfg-quick-msg"
          class="wfg-sidebar-commit-input"
          placeholder="提交这次修改说明 (Enter 提交)..."
        />
        <button id="wfg-quick-commit-btn" class="wfg-sidebar-commit-btn" title="Commit current workflow">
          ✔ Commit
        </button>
      </div>
    `;

    const anchor = searchInput.closest(".search-container, .input-container, [class*='search']") || searchInput.parentElement;
    if (anchor && anchor.parentElement) {
      anchor.parentElement.insertBefore(commitBar, anchor.nextSibling);
    } else {
      panel.insertBefore(commitBar, panel.firstChild);
    }

    const input = commitBar.querySelector("#wfg-quick-msg");
    const btn = commitBar.querySelector("#wfg-quick-commit-btn");

    const doCommit = async () => {
      const msg = input.value.trim();
      if (!msg) {
        input.focus();
        return;
      }
      const fileName = getCurrentWorkflowName();
      try {
        btn.disabled = true;
        btn.textContent = "Committing...";

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

        showToast(`✔ 已提交 [${data.commit_hash || "saved"}]: ${msg}`);
        input.value = "";

        this.injectFileBadges(panel, true);
      } catch (e) {
        alert(`Commit 失败: ${e.message}`);
      } finally {
        btn.disabled = false;
        btn.textContent = "✔ Commit";
      }
    };

    btn.onclick = doCommit;
    input.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        doCommit();
      }
    };

    this.updateBranchTag();
  }

  async updateBranchTag() {
    try {
      const res = await fetch("/workflow-git/status");
      const data = await res.json();
      if (data.success && data.status?.branch) {
        const tag = document.querySelector("#wfg-branch-tag");
        if (tag) tag.textContent = data.status.branch;
      }
    } catch (e) {}
  }

  injectFileBadges(panel, forceRefresh = false) {
    // Strictly search within panel, never touch outer body!
    const candidates = Array.from(panel.querySelectorAll("span, div, a, li, p"));
    for (const el of candidates) {
      if (el.children.length > 2) continue;
      const text = el.textContent ? el.textContent.trim() : "";
      if (text.endsWith(".json") && text.length < 80 && !text.includes("\n")) {
        const row = el.closest("[role='treeitem'], li, [class*='node'], [class*='item']") || el.parentElement;
        if (!row) continue;
        if (row.querySelector(".wfg-inline-badge")) continue;

        const badge = document.createElement("span");
        badge.className = "wfg-inline-badge";
        badge.innerHTML = `🌱 Git`;
        badge.title = `点击查看 [${text}] 的历史版本`;

        fetch(`/workflow-git/history?file=${encodeURIComponent(text)}&limit=10`)
          .then((r) => r.json())
          .then((data) => {
            if (data.success && data.history.length > 0) {
              badge.innerHTML = `🌱 ${data.history.length}`;
            }
          })
          .catch(() => {});

        badge.onclick = (e) => {
          e.stopPropagation();
          e.preventDefault();
          this.toggleFileHistory(row, text, badge);
        };

        row.appendChild(badge);
      }
    }
  }

  async toggleFileHistory(row, fileName, badge) {
    const nextEl = row.nextElementSibling;
    if (nextEl && nextEl.classList.contains("wfg-inline-history-tree")) {
      nextEl.remove();
      badge.classList.remove("expanded");
      this.expandedFiles.delete(fileName);
      return;
    }

    badge.classList.add("expanded");
    this.expandedFiles.add(fileName);

    const treeContainer = document.createElement("div");
    treeContainer.className = "wfg-inline-history-tree";
    treeContainer.innerHTML = `<div style="font-size: 10px; color: #64748b; padding: 4px;">正在读取历史版本...</div>`;
    row.parentElement.insertBefore(treeContainer, row.nextSibling);

    try {
      const res = await fetch(`/workflow-git/history?file=${encodeURIComponent(fileName)}&limit=30`);
      const data = await res.json();

      if (!data.success || !data.history.length) {
        treeContainer.innerHTML = `<div style="font-size: 10px; color: #64748b; padding: 4px;">暂无提交历史</div>`;
        return;
      }

      treeContainer.innerHTML = "";
      data.history.forEach((commit) => {
        const node = document.createElement("div");
        node.className = "wfg-history-node";
        node.innerHTML = `
          <div class="wfg-history-node-left">
            <div class="wfg-history-node-msg" title="${commit.message}">${commit.message}</div>
            <div class="wfg-history-node-meta">
              <span class="wfg-history-node-hash">${commit.short_hash}</span>
              <span>${commit.date.split(" ")[0]}</span>
            </div>
          </div>
          <button class="wfg-history-restore-btn" title="将此版本载入画布">
            载入
          </button>
        `;

        node.querySelector(".wfg-history-restore-btn").onclick = async (e) => {
          e.stopPropagation();
          if (!confirm(`确定要将 [${fileName}] 恢复到版本 ${commit.short_hash} ("${commit.message}") 吗？当前画布改动将被覆盖。`)) {
            return;
          }

          try {
            const checkoutRes = await fetch(`/workflow-git/checkout?hash=${commit.full_hash}&file=${encodeURIComponent(fileName)}`);
            const checkoutData = await checkoutRes.json();
            if (!checkoutData.success) throw new Error(checkoutData.error);

            if (checkoutData.workflow) {
              app.loadGraphData(checkoutData.workflow);
              showToast(`✔ 已载入 [${fileName}] (${commit.short_hash})`);
            }
          } catch (err) {
            alert(`载入失败: ${err.message}`);
          }
        };

        treeContainer.appendChild(node);
      });
    } catch (e) {
      treeContainer.innerHTML = `<div style="font-size: 10px; color: #ef4444; padding: 4px;">读取失败: ${e.message}</div>`;
    }
  }
}

// Register ComfyUI Extension
app.registerExtension({
  name: "comfyui.workflow.git",
  async setup() {
    injectCSS();

    // Start lightweight sidebar integrator
    new SidebarGitIntegration();

    // Global shortcut Alt + G focuses commit input
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

    console.log("[WorkflowGit] Sidebar Git Integration loaded safely without any observer loops!");
  }
});
