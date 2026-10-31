import { app } from "../../../scripts/app.js";

// Helper: inject css
function injectCSS() {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("../css/workflow-git.css", import.meta.url).href;
  document.head.appendChild(link);
}

// Toast helper
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

class WorkflowGitUI {
  constructor() {
    this.overlay = null;
    this.status = null;
    this.activeTab = "commit";
    this.initDOM();
  }

  initDOM() {
    this.overlay = document.createElement("div");
    this.overlay.className = "workflow-git-modal-overlay";
    this.overlay.innerHTML = `
      <div class="workflow-git-modal">
        <div class="workflow-git-header">
          <div class="workflow-git-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="18" cy="18" r="3"></circle>
              <circle cx="6" cy="6" r="3"></circle>
              <path d="M13 6h3a2 2 0 0 1 2 2v7"></path>
              <line x1="6" y1="9" x2="6" y2="21"></line>
            </svg>
            <span>Workflow Git Version Control</span>
          </div>
          <button class="workflow-git-close-btn" id="wfg-close" title="Close (Esc)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div class="workflow-git-tabs">
          <div class="workflow-git-tab active" data-tab="commit">Commit</div>
          <div class="workflow-git-tab" data-tab="history">History</div>
          <div class="workflow-git-tab" data-tab="settings">Settings</div>
        </div>

        <div class="workflow-git-body">
          <!-- Status Banner -->
          <div class="workflow-git-status-bar" id="wfg-status-bar">
            <span>Checking Git repository status...</span>
          </div>

          <!-- Commit Tab -->
          <div class="workflow-git-panel active" id="wfg-panel-commit">
            <div class="workflow-git-field">
              <label class="workflow-git-label">Workflow File Name (.json)</label>
              <input type="text" id="wfg-filename" class="workflow-git-input" placeholder="e.g. main-flow.json" value="workflow.json" />
            </div>

            <div class="workflow-git-field">
              <label class="workflow-git-label">Commit Message</label>
              <textarea id="wfg-message" class="workflow-git-textarea" placeholder="Describe your workflow changes (e.g. adjusted sampler to dpmpp_2m, added lora)..."></textarea>
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;">
              <button class="workflow-git-btn workflow-git-btn-secondary" id="wfg-cancel-btn">Cancel</button>
              <button class="workflow-git-btn workflow-git-btn-primary" id="wfg-commit-btn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M20 6L9 17l-5-5"></path>
                </svg>
                Commit Workflow
              </button>
            </div>
          </div>

          <!-- History Tab -->
          <div class="workflow-git-panel" id="wfg-panel-history">
            <div style="display: flex; gap: 10px; margin-bottom: 14px; align-items: center;">
              <select id="wfg-history-file-select" class="workflow-git-select" style="max-width: 260px;">
                <option value="">All Workflow Commits</option>
              </select>
              <button class="workflow-git-btn workflow-git-btn-secondary workflow-git-btn-sm" id="wfg-refresh-history">
                Refresh
              </button>
            </div>
            <div class="workflow-git-history-list" id="wfg-history-list">
              <div style="color: #71717a; text-align: center; padding: 20px;">No commits found yet.</div>
            </div>
          </div>

          <!-- Settings Tab -->
          <div class="workflow-git-panel" id="wfg-panel-settings">
            <div class="workflow-git-field">
              <label class="workflow-git-label">Workflows Directory Path (Supports relative paths like ../../../../../工作流)</label>
              <input type="text" id="wfg-config-dir" class="workflow-git-input" />
              <div style="font-size: 11px; color: #71717a; margin-top: 4px;" id="wfg-resolved-path"></div>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 24px;">
              <button class="workflow-git-btn workflow-git-btn-secondary" id="wfg-init-git-btn">
                Initialize Git Here
              </button>
              <button class="workflow-git-btn workflow-git-btn-primary" id="wfg-save-config-btn">
                Save Settings
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.overlay);
    this.bindEvents();
  }

  bindEvents() {
    // Close
    this.overlay.querySelector("#wfg-close").onclick = () => this.hide();
    this.overlay.querySelector("#wfg-cancel-btn").onclick = () => this.hide();
    this.overlay.onclick = (e) => {
      if (e.target === this.overlay) this.hide();
    };

    // Tabs
    const tabs = this.overlay.querySelectorAll(".workflow-git-tab");
    tabs.forEach((tab) => {
      tab.onclick = () => {
        tabs.forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        const tabName = tab.dataset.tab;
        this.activeTab = tabName;
        this.overlay.querySelectorAll(".workflow-git-panel").forEach((p) => p.classList.remove("active"));
        this.overlay.querySelector(`#wfg-panel-${tabName}`).classList.add("active");

        if (tabName === "history") this.loadHistory();
      };
    });

    // Commit button
    this.overlay.querySelector("#wfg-commit-btn").onclick = () => this.handleCommit();

    // History filter & refresh
    this.overlay.querySelector("#wfg-refresh-history").onclick = () => this.loadHistory();
    this.overlay.querySelector("#wfg-history-file-select").onchange = () => this.loadHistory();

    // Save config
    this.overlay.querySelector("#wfg-save-config-btn").onclick = () => this.saveConfig();

    // Init git
    this.overlay.querySelector("#wfg-init-git-btn").onclick = () => this.initGit();

    // ESC key
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.overlay.classList.contains("active")) {
        this.hide();
      }
    });
  }

  detectCurrentWorkflowName() {
    // Try to auto-detect current workflow name from ComfyUI
    try {
      // Modern TopBar workflow tab or title
      const tabEl = document.querySelector(".comfyui-workflow-tab.active, [data-testid='workflow-tab-active']");
      if (tabEl && tabEl.textContent.trim()) {
        let name = tabEl.textContent.trim().replace(/^\*/, "").trim();
        if (name) return name.endsWith(".json") ? name : `${name}.json`;
      }

      // Check title bar in header
      const titleEl = document.querySelector(".comfy-topbar-title, .comfyui-workflow-name");
      if (titleEl && titleEl.textContent.trim()) {
        let name = titleEl.textContent.trim().replace(/^\*/, "").trim();
        if (name) return name.endsWith(".json") ? name : `${name}.json`;
      }

      // Check app workflow manager
      if (app.workflowManager?.activeWorkflow?.name) {
        let name = app.workflowManager.activeWorkflow.name.replace(/^\*/, "").trim();
        if (name) return name.endsWith(".json") ? name : `${name}.json`;
      }
    } catch (e) {
      // Fallback
    }
    return "workflow.json";
  }

  async show() {
    this.overlay.classList.add("active");
    // Auto populate detected workflow name
    const detectedName = this.detectCurrentWorkflowName();
    const fileNameInput = this.overlay.querySelector("#wfg-filename");
    if (fileNameInput && (!fileNameInput.value || fileNameInput.value === "workflow.json")) {
      fileNameInput.value = detectedName;
    }
    await this.refreshStatus();
  }

  hide() {
    this.overlay.classList.remove("active");
  }

  async refreshStatus() {
    const statusBar = this.overlay.querySelector("#wfg-status-bar");
    try {
      const res = await fetch("/workflow-git/status");
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      this.status = data.status;
      const { is_repo, branch, target_dir, uncommitted, files } = data.status;

      // Update status bar
      if (is_repo) {
        statusBar.innerHTML = `
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="workflow-git-badge ok">● Git Active</span>
            <span>Branch: <b>${branch}</b></span>
          </div>
          <span style="color: #a1a1aa; font-size: 11px;">Path: ${target_dir}</span>
        `;
      } else {
        statusBar.innerHTML = `
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="workflow-git-badge warn">▲ Not a Git Repo</span>
            <span>Folder exists but git is not initialized</span>
          </div>
          <button class="workflow-git-btn workflow-git-btn-sm workflow-git-btn-secondary" id="wfg-quick-init">Initialize Git</button>
        `;
        const qInit = statusBar.querySelector("#wfg-quick-init");
        if (qInit) qInit.onclick = () => this.initGit();
      }

      // Populate file selects
      const fileSelect = this.overlay.querySelector("#wfg-history-file-select");
      fileSelect.innerHTML = '<option value="">All Workflow Commits</option>';
      files.forEach((f) => {
        const opt = document.createElement("option");
        opt.value = f;
        opt.textContent = f;
        fileSelect.appendChild(opt);
      });

      // Settings config
      this.overlay.querySelector("#wfg-config-dir").value = data.config.workflows_dir || "";
      this.overlay.querySelector("#wfg-resolved-path").textContent = `Resolved directory: ${data.resolved_dir}`;
    } catch (e) {
      statusBar.innerHTML = `<span style="color: #ef4444;">Error checking status: ${e.message}</span>`;
    }
  }

  async handleCommit() {
    const fileNameInput = this.overlay.querySelector("#wfg-filename");
    const msgInput = this.overlay.querySelector("#wfg-message");
    const btn = this.overlay.querySelector("#wfg-commit-btn");

    const fileName = fileNameInput.value.trim() || "workflow.json";
    const message = msgInput.value.trim();

    if (!message) {
      alert("Please enter a commit message!");
      msgInput.focus();
      return;
    }

    try {
      btn.disabled = true;
      btn.textContent = "Committing...";

      // Get current workflow graph from ComfyUI
      const workflowData = app.graph.serialize();

      const res = await fetch("/workflow-git/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_name: fileName,
          message: message,
          workflow: workflowData
        })
      });

      const result = await res.json();
      if (!result.success) throw new Error(result.error);

      showToast(`✔ Committed [${result.commit_hash || "saved"}]: ${message}`);
      msgInput.value = "";
      this.hide();
    } catch (e) {
      alert(`Commit failed: ${e.message}`);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 6L9 17l-5-5"></path>
        </svg>
        Commit Workflow
      `;
    }
  }

  async loadHistory() {
    const listEl = this.overlay.querySelector("#wfg-history-list");
    const file = this.overlay.querySelector("#wfg-history-file-select").value;

    listEl.innerHTML = '<div style="color: #71717a; text-align: center; padding: 20px;">Loading history...</div>';

    try {
      const url = file ? `/workflow-git/history?file=${encodeURIComponent(file)}` : "/workflow-git/history";
      const res = await fetch(url);
      const data = await res.json();

      if (!data.success || !data.history.length) {
        listEl.innerHTML = '<div style="color: #71717a; text-align: center; padding: 20px;">No commit history found.</div>';
        return;
      }

      listEl.innerHTML = "";
      data.history.forEach((item) => {
        const card = document.createElement("div");
        card.className = "workflow-git-commit-card";
        card.innerHTML = `
          <div class="workflow-git-commit-info">
            <div class="workflow-git-commit-msg">${item.message}</div>
            <div class="workflow-git-commit-meta">
              <span class="workflow-git-hash">${item.short_hash}</span>
              <span>${item.date}</span>
              <span>by ${item.author}</span>
            </div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="workflow-git-btn workflow-git-btn-sm workflow-git-btn-secondary wfg-restore-btn" data-hash="${item.full_hash}">
              Restore
            </button>
          </div>
        `;

        card.querySelector(".wfg-restore-btn").onclick = () => this.restoreCommit(item.full_hash, file);
        listEl.appendChild(card);
      });
    } catch (e) {
      listEl.innerHTML = `<div style="color: #ef4444; padding: 10px;">Failed to load history: ${e.message}</div>`;
    }
  }

  async restoreCommit(commitHash, targetFile) {
    let file = targetFile;
    if (!file) {
      file = prompt("Enter workflow file name to restore from this commit:", "workflow.json");
      if (!file) return;
    }

    if (!confirm(`Are you sure you want to restore '${file}' from commit ${commitHash.substring(0, 7)} to canvas? Current unsaved canvas changes will be overwritten.`)) {
      return;
    }

    try {
      const res = await fetch(`/workflow-git/checkout?hash=${commitHash}&file=${encodeURIComponent(file)}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      // Load graph onto canvas
      app.loadGraphData(data.workflow);
      showToast(`✔ Restored workflow from commit ${commitHash.substring(0, 7)}`);
      this.hide();
    } catch (e) {
      alert(`Failed to restore: ${e.message}`);
    }
  }

  async initGit() {
    try {
      const res = await fetch("/workflow-git/init", { method: "POST" });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      showToast("✔ Git repository initialized!");
      await this.refreshStatus();
    } catch (e) {
      alert(`Init failed: ${e.message}`);
    }
  }

  async saveConfig() {
    const dir = this.overlay.querySelector("#wfg-config-dir").value.trim();
    try {
      const res = await fetch("/workflow-git/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflows_dir: dir })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      showToast("✔ Configuration saved!");
      await this.refreshStatus();
    } catch (e) {
      alert(`Failed to save config: ${e.message}`);
    }
  }
}

// Register ComfyUI Extension
app.registerExtension({
  name: "comfyui.workflow.git",
  async setup() {
    injectCSS();
    const gitUI = new WorkflowGitUI();

    // 1. Modern TopBar Integration (v1.x)
    const injectTopBarButton = async () => {
      if (document.querySelector("#wfg-menu-btn")) return true;

      try {
        const buttonMod = await import("../../scripts/ui/components/button.js");
        const ComfyButton = buttonMod.ComfyButton;
        if (ComfyButton) {
          const btn = new ComfyButton({
            action: () => gitUI.show(),
            tooltip: "Workflow Git Version Control (Alt + G)",
            content: "🌱 Git",
            classList: "comfyui-button comfyui-menu-mobile-collapse primary"
          });
          btn.element.id = "wfg-menu-btn";

          if (app.menu?.settingsGroup?.element) {
            app.menu.settingsGroup.element.before(btn.element);
            return true;
          } else if (app.menu?.element) {
            app.menu.element.appendChild(btn.element);
            return true;
          }
        }
      } catch (e) {
        // Fallback to DOM injection
      }

      // Try searching for Manager button in TopBar
      const managerBtn = Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent && b.textContent.includes("Manager")
      );
      if (managerBtn && managerBtn.parentElement) {
        const btn = document.createElement("button");
        btn.id = "wfg-menu-btn";
        btn.className = "comfyui-button primary";
        btn.innerHTML = `<span style="margin-right: 4px;">🌱</span>Git`;
        btn.title = "Workflow Git Version Control (Alt + G)";
        btn.style.background = "#0284c7";
        btn.style.color = "#ffffff";
        btn.style.fontWeight = "bold";
        btn.style.margin = "0 4px";
        btn.onclick = () => gitUI.show();
        managerBtn.parentElement.insertBefore(btn, managerBtn);
        return true;
      }

      // Fallback for classic .comfy-menu
      const menu = document.querySelector(".comfy-menu") || app.ui?.menuContainer;
      if (menu) {
        const btn = document.createElement("button");
        btn.id = "wfg-menu-btn";
        btn.textContent = "Git Commit";
        btn.title = "Workflow Git (Alt + G)";
        btn.style.background = "#0284c7";
        btn.style.color = "#ffffff";
        btn.onclick = () => gitUI.show();
        menu.appendChild(btn);
        return true;
      }

      return false;
    };

    // 2. Always create a floating action button on screen edge (Triple insurance!)
    const injectFloatingButton = () => {
      if (document.querySelector("#wfg-float-btn")) return;
      const floatBtn = document.createElement("div");
      floatBtn.id = "wfg-float-btn";
      floatBtn.className = "workflow-git-float-btn";
      floatBtn.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <circle cx="18" cy="18" r="3"></circle>
          <circle cx="6" cy="6" r="3"></circle>
          <path d="M13 6h3a2 2 0 0 1 2 2v7"></path>
          <line x1="6" y1="9" x2="6" y2="21"></line>
        </svg>
        <span>Git (Alt+G)</span>
      `;
      floatBtn.title = "Open Workflow Git Version Control (Alt + G)";
      floatBtn.onclick = () => gitUI.show();
      document.body.appendChild(floatBtn);
    };

    // Periodic attempts to inject buttons as DOM stabilizes
    const tryInject = async () => {
      await injectTopBarButton();
      injectFloatingButton();
    };

    tryInject();
    setTimeout(tryInject, 500);
    setTimeout(tryInject, 1500);
    setTimeout(tryInject, 3000);

    // 3. Global shortcut Alt + G
    window.addEventListener("keydown", (e) => {
      if (e.altKey && (e.key === "g" || e.key === "G")) {
        e.preventDefault();
        gitUI.show();
      }
    });

    console.log("[WorkflowGit] Extension loaded successfully! Use Alt + G or click '🌱 Git' button.");
  }
});
