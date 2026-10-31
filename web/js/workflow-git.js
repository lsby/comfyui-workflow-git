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
          <div class="workflow-git-tab" data-tab="settings">Repository Info</div>
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
              <label class="workflow-git-label">Managed Workflows Directory (ComfyUI Native Workflows)</label>
              <input type="text" id="wfg-config-dir" class="workflow-git-input" readonly style="opacity: 0.8; cursor: not-allowed;" />
              <div style="font-size: 11px; color: #71717a; margin-top: 4px;" id="wfg-resolved-path"></div>
            </div>

            <div style="display: flex; justify-content: flex-end; align-items: center; margin-top: 24px;">
              <button class="workflow-git-btn workflow-git-btn-secondary" id="wfg-init-git-btn">
                Re-initialize Git
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

      const titleEl = document.querySelector(".comfy-topbar-title, .comfyui-workflow-name");
      if (titleEl && titleEl.textContent.trim()) {
        let name = titleEl.textContent.trim().replace(/^[*•\s]+/, "").trim();
        name = name.replace(/\s*\(\d+\)$/, "").trim();
        if (name) return name.endsWith(".json") ? name : `${name}.json`;
      }

      if (app.workflowManager?.activeWorkflow?.name) {
        let name = app.workflowManager.activeWorkflow.name.replace(/^[*•\s]+/, "").trim();
        name = name.replace(/\s*\(\d+\)$/, "").trim();
        if (name) return name.endsWith(".json") ? name : `${name}.json`;
      }
    } catch (e) {
      // Fallback
    }
    return "workflow.json";
  }

  async show() {
    this.overlay.classList.add("active");
    const detectedName = this.detectCurrentWorkflowName();
    const fileNameInput = this.overlay.querySelector("#wfg-filename");
    if (fileNameInput) {
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
      const { is_repo, branch, target_dir, files } = data.status;

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
      const currentSelected = fileSelect.value;
      fileSelect.innerHTML = '<option value="">All Workflow Commits</option>';
      files.forEach((f) => {
        const opt = document.createElement("option");
        opt.value = f;
        opt.textContent = f;
        if (f === currentSelected) opt.selected = true;
        fileSelect.appendChild(opt);
      });

      // Settings config
      this.overlay.querySelector("#wfg-config-dir").value = data.resolved_dir || "";
      this.overlay.querySelector("#wfg-resolved-path").textContent = `Native ComfyUI workflows location (100% linked with UI)`;
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
        const primaryFile = item.primary_file || (item.files && item.files[0]) || "";
        const fileTag = primaryFile
          ? `<span style="background: rgba(34, 197, 94, 0.15); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3); padding: 1px 6px; border-radius: 4px;">📄 ${primaryFile}</span>`
          : "";

        card.innerHTML = `
          <div class="workflow-git-commit-info">
            <div class="workflow-git-commit-msg" style="display: flex; align-items: center; gap: 8px;">
              <span>${item.message}</span>
              ${fileTag}
            </div>
            <div class="workflow-git-commit-meta">
              <span class="workflow-git-hash">${item.short_hash}</span>
              <span>${item.date}</span>
              <span>by ${item.author}</span>
            </div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="workflow-git-btn workflow-git-btn-sm workflow-git-btn-secondary wfg-restore-btn" data-hash="${item.full_hash}" data-file="${primaryFile}">
              Restore
            </button>
          </div>
        `;

        card.querySelector(".wfg-restore-btn").onclick = () => {
          this.restoreCommit(item.full_hash, primaryFile, item.short_hash, item.message);
        };
        listEl.appendChild(card);
      });
    } catch (e) {
      listEl.innerHTML = `<div style="color: #ef4444; padding: 10px;">Failed to load history: ${e.message}</div>`;
    }
  }

  async restoreCommit(commitHash, targetFile, shortHash = "", commitMsg = "") {
    const fileLabel = targetFile || "workflow";
    const msgLabel = commitMsg ? ` "${commitMsg}"` : "";
    const hashLabel = shortHash || commitHash.substring(0, 7);

    if (!confirm(`Are you sure you want to restore [${fileLabel}]${msgLabel} (${hashLabel}) onto the canvas? Current unsaved changes will be overwritten.`)) {
      return;
    }

    try {
      const paramFile = targetFile ? encodeURIComponent(targetFile) : "";
      const res = await fetch(`/workflow-git/checkout?hash=${commitHash}&file=${paramFile}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      if (data.workflow) {
        app.loadGraphData(data.workflow);
        showToast(`✔ Restored [${data.file || fileLabel}] from commit ${hashLabel}`);
        this.hide();
      } else {
        throw new Error("No workflow data found in commit content");
      }
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

      return false;
    };

    // 2. Draggable Floating Action Button with position persistence
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
      floatBtn.title = "Drag to reposition | Click to open (Alt + G)";

      const savedPos = localStorage.getItem("comfyui-workflow-git-pos");
      if (savedPos) {
        try {
          const { left, top } = JSON.parse(savedPos);
          const maxLeft = window.innerWidth - 120;
          const maxTop = window.innerHeight - 50;
          floatBtn.style.left = `${Math.min(Math.max(10, left), maxLeft)}px`;
          floatBtn.style.top = `${Math.min(Math.max(10, top), maxTop)}px`;
          floatBtn.style.right = "auto";
          floatBtn.style.bottom = "auto";
        } catch (e) {}
      }

      let isDragging = false;
      let hasMoved = false;
      let startX = 0, startY = 0;
      let initialLeft = 0, initialTop = 0;

      floatBtn.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        isDragging = true;
        hasMoved = false;
        startX = e.clientX;
        startY = e.clientY;

        const rect = floatBtn.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        floatBtn.style.transition = "none";
        e.preventDefault();
      });

      window.addEventListener("mousemove", (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
          hasMoved = true;
        }

        let newLeft = initialLeft + dx;
        let newTop = initialTop + dy;

        const maxLeft = window.innerWidth - floatBtn.offsetWidth - 10;
        const maxTop = window.innerHeight - floatBtn.offsetHeight - 10;
        newLeft = Math.max(10, Math.min(newLeft, maxLeft));
        newTop = Math.max(10, Math.min(newTop, maxTop));

        floatBtn.style.left = `${newLeft}px`;
        floatBtn.style.top = `${newTop}px`;
        floatBtn.style.right = "auto";
        floatBtn.style.bottom = "auto";
      });

      window.addEventListener("mouseup", () => {
        if (!isDragging) return;
        isDragging = false;
        floatBtn.style.transition = "background 0.15s, box-shadow 0.15s";

        if (hasMoved) {
          const rect = floatBtn.getBoundingClientRect();
          localStorage.setItem(
            "comfyui-workflow-git-pos",
            JSON.stringify({ left: rect.left, top: rect.top })
          );
        }
      });

      floatBtn.addEventListener("click", () => {
        if (hasMoved) {
          hasMoved = false;
          return;
        }
        gitUI.show();
      });

      document.body.appendChild(floatBtn);
    };

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
