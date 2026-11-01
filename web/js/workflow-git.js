import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

// Helper: inject css
function injectCSS() {
  const linkId = "workflow-git-css-link";
  if (!document.getElementById(linkId)) {
    const link = document.createElement("link");
    link.id = linkId;
    link.rel = "stylesheet";
    link.href = new URL("../css/workflow-git.css", import.meta.url).href;
    document.head.appendChild(link);
  }
}

// Toast notification helper
function showToast(message, duration = 2500) {
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

// Context Menu popup helper
function showContextMenu(x, y, items) {
  document.querySelectorAll(".wfg-context-menu").forEach((el) => el.remove());

  const menu = document.createElement("div");
  menu.className = "wfg-context-menu";

  const maxX = window.innerWidth - 190;
  const maxY = window.innerHeight - (items.length * 36 + 20);
  menu.style.left = `${Math.min(x, maxX)}px`;
  menu.style.top = `${Math.min(y, maxY)}px`;

  items.forEach((it) => {
    if (it.divider) {
      const div = document.createElement("div");
      div.className = "wfg-context-divider";
      menu.appendChild(div);
      return;
    }
    const itemEl = document.createElement("div");
    itemEl.className = `wfg-context-item ${it.danger ? "danger" : ""}`;
    itemEl.innerHTML = `<span>${it.icon || ""}</span><span>${it.label}</span>`;
    itemEl.onclick = async (e) => {
      e.stopPropagation();
      menu.remove();
      try {
        await it.onClick();
      } catch (err) {
        showToast(err.message || "操作失败");
      }
    };
    menu.appendChild(itemEl);
  });

  document.body.appendChild(menu);

  const closeListener = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener("pointerdown", closeListener);
    }
  };
  setTimeout(() => document.addEventListener("pointerdown", closeListener), 10);
}

// Global State
let treeItems = [];
let expandedFolders = new Set();
let searchQuery = "";
let currentActiveWorkflow = null; // e.g. "lcm-demo.json" or "sub/test.json"
let cleanBaselineHash = null;
let isDirty = false;
let historyList = [];
let historyPage = 1;
const historyPageSize = 5;
let mountedPanel = null;
let dirtyCheckTimer = null;

// Normalizing Graph Data for dirty check (ignoring pan/zoom)
function getNormalizedGraphData() {
  try {
    if (!app.graph) return null;
    const raw = app.graph.serialize();
    if (!raw) return null;
    const clean = JSON.parse(JSON.stringify(raw));
    if (clean.extra?.ds) {
      delete clean.extra.ds.offset;
      delete clean.extra.ds.scale;
    }
    return clean;
  } catch (e) {
    return null;
  }
}

function computeHash(obj) {
  if (!obj) return "";
  const str = JSON.stringify(obj);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return (hash >>> 0).toString(16);
}

function setCleanBaseline(graphData) {
  if (graphData) {
    const clean = JSON.parse(JSON.stringify(graphData));
    if (clean.extra?.ds) {
      delete clean.extra.ds.offset;
      delete clean.extra.ds.scale;
    }
    cleanBaselineHash = computeHash(clean);
  } else {
    cleanBaselineHash = computeHash(getNormalizedGraphData());
  }
  isDirty = false;
  updateDirtyUI();
}

function performDirtyCheck() {
  if (!currentActiveWorkflow || !cleanBaselineHash) {
    isDirty = false;
    updateDirtyUI();
    return;
  }
  const currentHash = computeHash(getNormalizedGraphData());
  const newDirty = currentHash !== cleanBaselineHash;
  if (newDirty !== isDirty) {
    isDirty = newDirty;
    updateDirtyUI();
  }
}

function triggerDirtyCheckDebounced() {
  if (dirtyCheckTimer) clearTimeout(dirtyCheckTimer);
  dirtyCheckTimer = setTimeout(performDirtyCheck, 350);
}

// Fetch Workflows List from ComfyUI userdata
async function fetchWorkflowsList() {
  try {
    const resp = await api.fetchApi("/userdata?dir=workflows&recurse=true&split=false&full_info=true");
    if (resp.status === 200) {
      treeItems = await resp.json();
    }
  } catch (e) {
    console.error("[WorkflowVersion] Error fetching workflows list:", e);
  }
}

// Build hierarchical folder/file tree
function buildFileTree(items, query = "") {
  const root = { name: "root", isFolder: true, relPath: "", children: {}, files: [] };
  const lowerQuery = query.trim().toLowerCase();

  for (const item of items) {
    let rawPath = (item.path || "").replace(/\\/g, "/").replace(/^\/+/, "");
    if (!rawPath || rawPath.startsWith(".workflow_versions") || rawPath.startsWith(".")) {
      continue;
    }

    const isExplicitDir = rawPath.endsWith("/");
    if (isExplicitDir) rawPath = rawPath.slice(0, -1);

    const parts = rawPath.split("/");

    let curr = root;
    for (let i = 0; i < parts.length - (isExplicitDir ? 0 : 1); i++) {
      const part = parts[i];
      if (!part) continue;
      const subRel = parts.slice(0, i + 1).join("/");
      if (!curr.children[part]) {
        curr.children[part] = {
          name: part,
          relPath: subRel,
          isFolder: true,
          children: {},
          files: []
        };
      }
      curr = curr.children[part];
    }

    if (!isExplicitDir) {
      const fileName = parts[parts.length - 1];
      if (fileName.endsWith(".json")) {
        curr.files.push({
          name: fileName,
          relPath: rawPath,
          isFolder: false,
          size: item.size,
          modified: item.modified
        });
      }
    }
  }

  // Convert map children to sorted array
  function toArrayNode(node) {
    const folderList = Object.values(node.children)
      .map(toArrayNode)
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));

    const fileList = node.files.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));

    // If query is present, filter
    let visibleFolders = folderList;
    let visibleFiles = fileList;
    if (lowerQuery) {
      visibleFiles = fileList.filter((f) => f.name.toLowerCase().includes(lowerQuery));
      visibleFolders = folderList.filter((f) => f.name.toLowerCase().includes(lowerQuery) || f.files.length > 0 || f.children.length > 0);
    }

    const totalCount = visibleFiles.length + visibleFolders.reduce((acc, c) => acc + c.totalCount, 0);

    return {
      name: node.name,
      relPath: node.relPath,
      isFolder: true,
      children: visibleFolders,
      files: visibleFiles,
      totalCount
    };
  }

  return toArrayNode(root);
}

// Fetch version history for current active workflow
async function fetchHistory(filename) {
  if (!filename) {
    historyList = [];
    historyPage = 1;
    updateHistoryUI();
    return;
  }
  try {
    const resp = await fetch(`/workflow-git/history?file=${encodeURIComponent(filename)}&filename=${encodeURIComponent(filename)}`);
    const data = await resp.json();
    if (data.success) {
      historyList = data.history || [];
      historyPage = 1;
    } else {
      historyList = [];
    }
  } catch (e) {
    historyList = [];
  }
  updateHistoryUI();
}

// Open / Load workflow into ComfyUI canvas
async function openWorkflow(relPath, force = false) {
  try {
    const wfStore = app.extensionManager?.workflow;
    const fullPath = "workflows/" + relPath;

    // 1. If it's already the active workflow and not forcing reload, just ensure active tab is focused and return
    if (!force && currentActiveWorkflow === relPath) {
      if (wfStore) {
        const item = wfStore.getWorkflowByPath?.(fullPath);
        if (item && wfStore.activeWorkflow?.path !== fullPath) {
          await wfStore.openWorkflow(item);
        }
      }
      updateActiveCardUI();
      renderTree();
      return;
    }

    // 2. Look up the workflow item in ComfyUI store
    let item = wfStore?.getWorkflowByPath?.(fullPath);
    if (!item && wfStore?.syncWorkflows) {
      await wfStore.syncWorkflows();
      item = wfStore.getWorkflowByPath?.(fullPath);
    }

    // 3. Load the workflow content
    const resp = await api.getUserData(fullPath);
    if (resp.status !== 200) {
      showToast(`载入工作流失败: ${resp.statusText}`);
      return;
    }
    const graphData = await resp.json();

    // 4. If current active tab is an untouched clean temporary tab ("Unsaved Workflow"), clean it up
    if (wfStore) {
      const activeWf = wfStore.activeWorkflow;
      if (activeWf && activeWf.isTemporary && !activeWf.isModified) {
        try {
          if (typeof wfStore.detachWorkflow === "function") {
            wfStore.detachWorkflow(activeWf);
          }
        } catch (e) {}
      }
    }

    // 5. Load graph data passing the workflow instance (or relPath) as 4th arg
    // This tells ComfyUI this is an existing workflow so it NEVER spawns "Unsaved Workflow"
    await app.loadGraphData(graphData, true, true, item || relPath);

    // 6. Ensure wfStore marks this workflow as active
    if (wfStore && item) {
      try {
        await wfStore.openWorkflow(item);
      } catch (e) {}
    }

    currentActiveWorkflow = relPath;
    setCleanBaseline(graphData);
    await fetchHistory(relPath);
    updateActiveCardUI();
    renderTree();
    showToast(`已载入: ${relPath.split("/").pop()}`);
  } catch (err) {
    showToast(`载入失败: ${err.message}`);
  }
}

// Create new workflow in folder
async function createNewWorkflow(parentFolder = "") {
  const name = prompt("请输入新工作流名称:", "新工作流");
  if (!name || !name.trim()) return;
  const cleanName = name.trim().endsWith(".json") ? name.trim() : `${name.trim()}.json`;
  const relPath = parentFolder ? `${parentFolder}/${cleanName}` : cleanName;

  const defaultGraph = {
    last_node_id: 1,
    last_link_id: 0,
    nodes: [],
    links: [],
    groups: [],
    config: {},
    extra: {},
    version: 0.4
  };

  try {
    await api.storeUserData("workflows/" + relPath, JSON.stringify(defaultGraph), { overwrite: false });
    await fetchWorkflowsList();
    if (parentFolder) expandedFolders.add(parentFolder);
    await openWorkflow(relPath);
    showToast(`已创建工作流: ${cleanName}`);
  } catch (e) {
    showToast(`创建失败: ${e.message}`);
  }
}

// Create new folder
async function createNewFolder(parentFolder = "") {
  const name = prompt("请输入文件夹名称:", "新建文件夹");
  if (!name || !name.trim()) return;
  const folderName = name.trim().replace(/[\\\/]/g, "");
  const targetFolder = parentFolder ? `${parentFolder}/${folderName}` : folderName;

  try {
    const resp = await fetch("/workflow-git/folder/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder: targetFolder })
    });
    const data = await resp.json();
    if (data.success) {
      expandedFolders.add(targetFolder);
      if (parentFolder) expandedFolders.add(parentFolder);
      await fetchWorkflowsList();
      renderTree();
      showToast(`已创建文件夹: ${folderName}`);
    } else {
      alert(data.error || "创建文件夹失败");
    }
  } catch (e) {
    showToast(`创建失败: ${e.message}`);
  }
}

// Rename folder
async function renameFolder(oldFolder) {
  const oldBase = oldFolder.split("/").pop();
  const newName = prompt("请输入新文件夹名称:", oldBase);
  if (!newName || !newName.trim() || newName.trim() === oldBase) return;
  const parent = oldFolder.includes("/") ? oldFolder.slice(0, oldFolder.lastIndexOf("/")) : "";
  const newFolder = parent ? `${parent}/${newName.trim()}` : newName.trim();

  try {
    const resp = await fetch("/workflow-git/folder/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ src: oldFolder, dst: newFolder })
    });
    const data = await resp.json();
    if (data.success) {
      if (currentActiveWorkflow && currentActiveWorkflow.startsWith(oldFolder + "/")) {
        currentActiveWorkflow = currentActiveWorkflow.replace(oldFolder + "/", newFolder + "/");
      }
      expandedFolders.delete(oldFolder);
      expandedFolders.add(newFolder);
      await fetchWorkflowsList();
      renderTree();
      updateActiveCardUI();
      showToast(`已重命名: ${newName.trim()}`);
    } else {
      alert(data.error || "重命名失败");
    }
  } catch (e) {
    showToast(`操作失败: ${e.message}`);
  }
}

// Delete folder
async function deleteFolder(folderPath) {
  if (!confirm(`确定要删除文件夹 "${folderPath}" 及其全部内容和历史版本吗？此操作不可撤销！`)) return;
  try {
    const resp = await fetch("/workflow-git/folder/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder: folderPath })
    });
    const data = await resp.json();
    if (data.success) {
      if (currentActiveWorkflow && currentActiveWorkflow.startsWith(folderPath + "/")) {
        currentActiveWorkflow = null;
        updateActiveCardUI();
      }
      expandedFolders.delete(folderPath);
      await fetchWorkflowsList();
      renderTree();
      showToast(`已删除文件夹: ${folderPath}`);
    } else {
      alert(data.error || "删除失败");
    }
  } catch (e) {
    showToast(`删除失败: ${e.message}`);
  }
}

// Rename workflow file
async function renameWorkflow(oldRelPath) {
  const oldBase = oldRelPath.split("/").pop().replace(/\.json$/, "");
  const newBase = prompt("请输入新的工作流名称:", oldBase);
  if (!newBase || !newBase.trim() || newBase.trim() === oldBase) return;
  const newFileName = newBase.trim() + ".json";
  const parent = oldRelPath.includes("/") ? oldRelPath.slice(0, oldRelPath.lastIndexOf("/")) : "";
  const newRelPath = parent ? `${parent}/${newFileName}` : newFileName;

  try {
    const resp = await fetch("/workflow-git/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ src: oldRelPath, dst: newRelPath })
    });
    const data = await resp.json();
    if (data.success) {
      if (currentActiveWorkflow === oldRelPath) {
        currentActiveWorkflow = newRelPath;
      }
      await fetchWorkflowsList();
      renderTree();
      updateActiveCardUI();
      showToast(`已重命名: ${newFileName}`);
    } else {
      alert(data.error || "重命名失败");
    }
  } catch (e) {
    showToast(`重命名失败: ${e.message}`);
  }
}

// Duplicate workflow file
async function duplicateWorkflow(relPath) {
  try {
    const resp = await api.getUserData("workflows/" + relPath);
    if (resp.status !== 200) {
      showToast("读取工作流失败");
      return;
    }
    const content = await resp.text();
    const dir = relPath.includes("/") ? relPath.slice(0, relPath.lastIndexOf("/")) : "";
    const baseName = relPath.split("/").pop().replace(/\.json$/, "");
    const newName = `${baseName} (副本).json`;
    const newRelPath = dir ? `${dir}/${newName}` : newName;

    await api.storeUserData("workflows/" + newRelPath, content, { overwrite: false });
    await fetchWorkflowsList();
    renderTree();
    showToast(`已创建副本: ${newName}`);
  } catch (e) {
    showToast(`复制失败: ${e.message}`);
  }
}

// Delete workflow file
async function deleteWorkflow(relPath) {
  if (!confirm(`确定要彻底删除工作流 "${relPath}" 吗？其版本历史也将被清除！`)) return;
  try {
    await api.deleteUserData("workflows/" + relPath);
    await fetch("/workflow-git/delete-workflow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: relPath })
    }).catch(() => {});

    if (currentActiveWorkflow === relPath) {
      currentActiveWorkflow = null;
      updateActiveCardUI();
    }
    await fetchWorkflowsList();
    renderTree();
    showToast(`已删除: ${relPath}`);
  } catch (e) {
    showToast(`删除失败: ${e.message}`);
  }
}

// Move workflow item via drag & drop
async function moveWorkflowItem(srcRelPath, targetFolder) {
  const fileName = srcRelPath.split("/").pop();
  const dstRelPath = targetFolder ? `${targetFolder}/${fileName}` : fileName;
  if (srcRelPath === dstRelPath) return;

  try {
    const resp = await fetch("/workflow-git/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ src: srcRelPath, dst: dstRelPath })
    });
    const data = await resp.json();
    if (data.success) {
      if (currentActiveWorkflow === srcRelPath) {
        currentActiveWorkflow = dstRelPath;
      }
      if (targetFolder) expandedFolders.add(targetFolder);
      await fetchWorkflowsList();
      renderTree();
      updateActiveCardUI();
      showToast(`已移动到: ${targetFolder || "根目录"}`);
    } else {
      alert(data.error || "移动失败");
    }
  } catch (e) {
    showToast(`移动失败: ${e.message}`);
  }
}

// Commit new version
async function commitActiveWorkflow(message) {
  if (!currentActiveWorkflow) {
    showToast("没有处于激活状态的工作流");
    return;
  }
  const cleanGraph = getNormalizedGraphData();
  if (!cleanGraph) {
    showToast("无法获取当前画布数据");
    return;
  }

  const msg = (message || "").trim() || "版本更新";
  try {
    const resp = await fetch("/workflow-git/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: currentActiveWorkflow,
        message: msg,
        data: cleanGraph
      })
    });
    const result = await resp.json();
    if (result.success) {
      const commitHash = result.short_hash || result.hash || result.id || "";
      showToast(`已保存版本: #${commitHash.slice(0, 7)}`);
      setCleanBaseline(cleanGraph);
      await fetchHistory(currentActiveWorkflow);
    } else {
      alert(result.error || "保存失败");
    }
  } catch (e) {
    showToast(`保存失败: ${e.message}`);
  }
}

// Restore specific version
async function restoreVersion(hash) {
  if (!currentActiveWorkflow) return;
  try {
    const resp = await fetch("/workflow-git/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: currentActiveWorkflow,
        hash: hash
      })
    });
    const result = await resp.json();
    if (result.success && result.data) {
      const wfStore = app.extensionManager?.workflow;
      const item = wfStore?.getWorkflowByPath?.("workflows/" + currentActiveWorkflow);
      await app.loadGraphData(result.data, true, true, item || currentActiveWorkflow);
      setCleanBaseline(result.data);
      await fetchHistory(currentActiveWorkflow);
      showToast(`已载入版本: #${hash.slice(0, 7)}`);
    } else {
      alert(result.error || "载入版本失败");
    }
  } catch (e) {
    showToast(`载入版本失败: ${e.message}`);
  }
}

// Delete specific version
async function deleteVersion(hash) {
  if (!currentActiveWorkflow) return;
  if (!confirm(`确定要删除版本 #${hash.slice(0, 7)} 吗？`)) return;
  try {
    const resp = await fetch("/workflow-git/delete-version", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: currentActiveWorkflow,
        hash: hash
      })
    });
    const result = await resp.json();
    if (result.success) {
      showToast(`已删除版本: #${hash.slice(0, 7)}`);
      await fetchHistory(currentActiveWorkflow);
    } else {
      alert(result.error || "删除版本失败");
    }
  } catch (e) {
    showToast(`删除版本失败: ${e.message}`);
  }
}

// UI Update functions
function updateDirtyUI() {
  const dirtyBadge = mountedPanel?.querySelector(".wfg-dirty-badge");
  if (!dirtyBadge) return;
  if (isDirty) {
    dirtyBadge.className = "wfg-dirty-badge dirty";
    dirtyBadge.innerHTML = "<span>●</span> 已修改";
  } else {
    dirtyBadge.className = "wfg-dirty-badge clean";
    dirtyBadge.innerHTML = "<span>✓</span> 干净";
  }
}

function updateActiveCardUI() {
  if (!mountedPanel) return;
  const card = mountedPanel.querySelector(".wfg-version-card");
  if (!card) return;

  if (!currentActiveWorkflow) {
    card.style.display = "none";
    return;
  }
  card.style.display = "block";

  const titleEl = card.querySelector(".wfg-active-file-title");
  if (titleEl) {
    titleEl.innerHTML = `<span class="wfg-tab-icon" style="font-size: 13px; margin-right: 2px;"></span> <span>${currentActiveWorkflow}</span>`;
  }

  const hashBadge = card.querySelector(".wfg-version-hash-badge");
  if (hashBadge) {
    const latest = historyList[0];
    const latestHash = latest ? (latest.short_hash || latest.id || latest.hash || "") : "";
    if (latestHash) {
      hashBadge.textContent = `#${latestHash.slice(0, 7)}`;
      hashBadge.style.display = "inline-block";
    } else {
      hashBadge.style.display = "none";
    }
  }

  updateDirtyUI();
  updateHistoryUI();
}

function updateHistoryUI() {
  if (!mountedPanel) return;
  const listEl = mountedPanel.querySelector(".wfg-history-list");
  const paginationEl = mountedPanel.querySelector(".wfg-pagination");
  if (!listEl || !paginationEl) return;

  if (!historyList || historyList.length === 0) {
    listEl.innerHTML = `<div style="text-align: center; color: #71717a; padding: 12px; font-size: 11px;">暂无保存的历史版本</div>`;
    paginationEl.style.display = "none";
    return;
  }

  paginationEl.style.display = "flex";
  const totalPages = Math.ceil(historyList.length / historyPageSize) || 1;
  if (historyPage > totalPages) historyPage = totalPages;
  if (historyPage < 1) historyPage = 1;

  const startIdx = (historyPage - 1) * historyPageSize;
  const pagedItems = historyList.slice(startIdx, startIdx + historyPageSize);
  const latestHash = historyList[0] ? (historyList[0].short_hash || historyList[0].id || historyList[0].hash || "") : "";

  listEl.innerHTML = "";
  pagedItems.forEach((ver) => {
    const verHash = ver.short_hash || ver.id || ver.hash || "";
    const isBase = verHash && verHash === latestHash;
    const item = document.createElement("div");
    item.className = `wfg-history-item ${isBase ? "current-base" : ""}`;

    const dateStr = ver.date ? new Date(ver.date).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
    item.innerHTML = `
      <div class="wfg-history-info">
        <div class="wfg-history-msg" title="${ver.message}">${ver.message || "无说明"}</div>
        <div class="wfg-history-meta">
          <span class="hash">#${verHash.slice(0, 7)}</span>
          ${isBase ? '<span class="base-tag">当前基底</span>' : ""}
          <span>${dateStr}</span>
        </div>
      </div>
      <div class="wfg-history-actions">
        ${isBase ? '<span class="wfg-history-btn" style="cursor: default; opacity: 0.6;">当前</span>' : `<button class="wfg-history-btn load" data-hash="${verHash}">载入</button>`}
        <button class="wfg-history-btn delete" data-hash="${verHash}" title="删除该版本">🗑️</button>
      </div>
    `;

    item.querySelector(".load")?.addEventListener("click", () => restoreVersion(verHash));
    item.querySelector(".delete")?.addEventListener("click", () => deleteVersion(verHash));
    listEl.appendChild(item);
  });

  paginationEl.innerHTML = `
    <button class="wfg-page-btn prev" ${historyPage <= 1 ? "disabled" : ""}>◀ 上一页</button>
    <span>${historyPage} / ${totalPages} (${historyList.length}条)</span>
    <button class="wfg-page-btn next" ${historyPage >= totalPages ? "disabled" : ""}>下一页 ▶</button>
  `;

  paginationEl.querySelector(".prev")?.addEventListener("click", () => {
    if (historyPage > 1) {
      historyPage--;
      updateHistoryUI();
    }
  });
  paginationEl.querySelector(".next")?.addEventListener("click", () => {
    if (historyPage < totalPages) {
      historyPage++;
      updateHistoryUI();
    }
  });
}

// Render Folder Tree DOM
function renderTree() {
  if (!mountedPanel) return;
  const container = mountedPanel.querySelector(".wfg-tree-container");
  if (!container) return;

  const treeData = buildFileTree(treeItems, searchQuery);
  container.innerHTML = "";

  if (treeData.children.length === 0 && treeData.files.length === 0) {
    container.innerHTML = `<div class="wfg-tree-empty">${searchQuery ? "未找到匹配的工作流" : "暂无工作流文件"}</div>`;
    return;
  }

  // Allow drop on root
  container.ondragover = (e) => {
    e.preventDefault();
  };
  container.ondrop = async (e) => {
    e.preventDefault();
    const src = e.dataTransfer.getData("text/plain");
    if (src) await moveWorkflowItem(src, "");
  };

  function renderSubTree(node, parentEl) {
    // Render folders first
    node.children.forEach((folder) => {
      const isExpanded = expandedFolders.has(folder.relPath);
      const folderNode = document.createElement("div");
      folderNode.className = "wfg-tree-node";

      const content = document.createElement("div");
      content.className = "wfg-tree-item-content";
      content.innerHTML = `
        <span class="wfg-tree-arrow ${isExpanded ? "expanded" : ""}">▶</span>
        <span class="wfg-tree-icon">${isExpanded ? "📂" : "📁"}</span>
        <span class="wfg-tree-label">${folder.name}</span>
        <span class="wfg-tree-badge">${folder.totalCount}</span>
      `;

      // Expand/Collapse click
      content.onclick = (e) => {
        e.stopPropagation();
        if (expandedFolders.has(folder.relPath)) {
          expandedFolders.delete(folder.relPath);
        } else {
          expandedFolders.add(folder.relPath);
        }
        renderTree();
      };

      // Folder Context Menu
      content.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        showContextMenu(e.clientX, e.clientY, [
          {
            icon: "📄",
            label: "在此新建工作流",
            onClick: () => createNewWorkflow(folder.relPath)
          },
          {
            icon: "📁",
            label: "在此新建子文件夹",
            onClick: () => createNewFolder(folder.relPath)
          },
          { divider: true },
          {
            icon: "✏️",
            label: "重命名文件夹",
            onClick: () => renameFolder(folder.relPath)
          },
          {
            icon: "🗑️",
            label: "删除文件夹",
            danger: true,
            onClick: () => deleteFolder(folder.relPath)
          }
        ]);
      };

      // Folder Drag & Drop target
      content.ondragover = (e) => {
        e.preventDefault();
        e.stopPropagation();
        content.classList.add("wfg-drag-over");
      };
      content.ondragleave = (e) => {
        e.stopPropagation();
        content.classList.remove("wfg-drag-over");
      };
      content.ondrop = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        content.classList.remove("wfg-drag-over");
        const src = e.dataTransfer.getData("text/plain");
        if (src) await moveWorkflowItem(src, folder.relPath);
      };

      folderNode.appendChild(content);

      if (isExpanded) {
        const childrenContainer = document.createElement("div");
        childrenContainer.className = "wfg-tree-children";
        renderSubTree(folder, childrenContainer);
        folderNode.appendChild(childrenContainer);
      }

      parentEl.appendChild(folderNode);
    });

    // Render files
    node.files.forEach((file) => {
      const isActive = currentActiveWorkflow === file.relPath;
      const fileNode = document.createElement("div");
      fileNode.className = "wfg-tree-node";

      const content = document.createElement("div");
      content.className = `wfg-tree-item-content ${isActive ? "active" : ""}`;
      content.draggable = true;
      content.innerHTML = `
        <span class="wfg-tree-arrow empty"></span>
        <span class="wfg-tree-icon">📄</span>
        <span class="wfg-tree-label" title="${file.relPath}">${file.name}</span>
      `;

      // Open on click
      content.onclick = (e) => {
        e.stopPropagation();
        openWorkflow(file.relPath);
      };

      // File Context Menu
      content.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        showContextMenu(e.clientX, e.clientY, [
          {
            icon: "📂",
            label: "载入画布",
            onClick: () => openWorkflow(file.relPath)
          },
          {
            icon: "📋",
            label: "复制副本",
            onClick: () => duplicateWorkflow(file.relPath)
          },
          {
            icon: "✏️",
            label: "重命名工作流",
            onClick: () => renameWorkflow(file.relPath)
          },
          { divider: true },
          {
            icon: "🗑️",
            label: "删除工作流",
            danger: true,
            onClick: () => deleteWorkflow(file.relPath)
          }
        ]);
      };

      // Drag start
      content.ondragstart = (e) => {
        e.dataTransfer.setData("text/plain", file.relPath);
        e.dataTransfer.effectAllowed = "move";
      };

      fileNode.appendChild(content);
      parentEl.appendChild(fileNode);
    });
  }

  renderSubTree(treeData, container);
}

// Mount the custom panel inside ComfyUI sidebar slot
function mountWorkflowGitPanel(rootEl) {
  mountedPanel = rootEl;
  rootEl.innerHTML = `
    <div class="wfg-sidebar-root">
      <!-- Header -->
      <div class="wfg-header">
        <div class="wfg-title">
          <span class="wfg-tab-icon" style="font-size: 14px; margin-right: 2px;"></span>
          <span>工作流版本管理</span>
        </div>
        <div class="wfg-header-actions">
          <button class="wfg-icon-btn btn-refresh" title="刷新列表">🔄</button>
        </div>
      </div>

      <!-- Search -->
      <div class="wfg-search-container">
        <div class="wfg-search-box">
          <span class="pi pi-search" style="color: #71717a; font-size: 11px;"></span>
          <input class="wfg-search-input" placeholder="搜索工作流..." value="${searchQuery}" />
          <span class="wfg-search-clear" style="display: ${searchQuery ? "block" : "none"};">✕</span>
        </div>
      </div>

      <!-- Active Workflow Version Card -->
      <div class="wfg-version-card" style="display: ${currentActiveWorkflow ? "block" : "none"};">
        <div class="wfg-version-card-header">
          <div class="wfg-active-file-title" title="${currentActiveWorkflow || ""}">
            <span class="wfg-tab-icon" style="font-size: 13px; margin-right: 2px;"></span>
            <span>${currentActiveWorkflow || ""}</span>
          </div>
          <div class="wfg-badges-right">
            <span class="wfg-version-hash-badge">#------</span>
            <span class="wfg-dirty-badge clean"><span>✓</span> 干净</span>
          </div>
        </div>
        <div class="wfg-commit-row">
          <input class="wfg-commit-input" placeholder="版本修改说明 (Enter 保存)..." />
          <button class="wfg-commit-btn">✓ 保存</button>
        </div>
        <div class="wfg-history-list"></div>
        <div class="wfg-pagination"></div>
      </div>

      <!-- Tree Explorer Section -->
      <div class="wfg-tree-section">
        <div class="wfg-tree-header">
          <span>工程文件目录</span>
        </div>
        <div class="wfg-tree-container"></div>
      </div>
    </div>
  `;

  // Bind Header actions
  rootEl.querySelector(".btn-refresh")?.addEventListener("click", async () => {
    await fetchWorkflowsList();
    if (currentActiveWorkflow) await fetchHistory(currentActiveWorkflow);
    renderTree();
    updateActiveCardUI();
    showToast("列表已刷新");
  });

  // Bind Search input
  const searchInput = rootEl.querySelector(".wfg-search-input");
  const searchClear = rootEl.querySelector(".wfg-search-clear");
  searchInput?.addEventListener("input", (e) => {
    searchQuery = e.target.value;
    if (searchClear) searchClear.style.display = searchQuery ? "block" : "none";
    renderTree();
  });
  searchClear?.addEventListener("click", () => {
    searchQuery = "";
    if (searchInput) searchInput.value = "";
    searchClear.style.display = "none";
    renderTree();
  });

  // Bind Commit input & button
  const commitInput = rootEl.querySelector(".wfg-commit-input");
  const commitBtn = rootEl.querySelector(".wfg-commit-btn");
  const doCommit = async () => {
    const val = commitInput.value;
    commitInput.value = "";
    await commitActiveWorkflow(val);
  };
  commitBtn?.addEventListener("click", doCommit);
  commitInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doCommit();
    }
  });

  // Initial render
  if (treeItems.length === 0) {
    fetchWorkflowsList().then(() => {
      try { renderTree(); } catch (e) { console.error(e); }
    });
  }
  if (currentActiveWorkflow && historyList.length === 0) {
    fetchHistory(currentActiveWorkflow).then(() => {
      try { updateActiveCardUI(); } catch (e) { console.error(e); }
    });
  }

  try {
    updateActiveCardUI();
  } catch (e) {
    console.error("[WorkflowVersion] Error updating active card:", e);
  }
  try {
    renderTree();
  } catch (e) {
    console.error("[WorkflowVersion] Error rendering tree:", e);
  }
}

function unmountWorkflowGitPanel() {
  mountedPanel = null;
}

// Track active workflow from ComfyUI
function syncActiveWorkflowFromComfy() {
  try {
    const wfStore = app.extensionManager?.workflow;
    const activeKey = wfStore?.activeWorkflow?.key;
    if (activeKey && activeKey !== currentActiveWorkflow) {
      currentActiveWorkflow = activeKey;
      setCleanBaseline(getNormalizedGraphData());
      fetchHistory(currentActiveWorkflow).then(() => {
        try { updateActiveCardUI(); } catch (e) {}
      });
      try { updateActiveCardUI(); } catch (e) {}
      try { renderTree(); } catch (e) {}
    }
  } catch (e) {}
}

// Register ComfyUI Extension
app.registerExtension({
  name: "comfyui.workflow.git",
  async setup(comfyApp) {
    injectCSS();

    // 1. Hide official workflows sidebar tab
    try {
      if (comfyApp.extensionManager && typeof comfyApp.extensionManager.unregisterSidebarTab === "function") {
        comfyApp.extensionManager.unregisterSidebarTab("workflows");
      }
    } catch (e) {
      console.warn("[WorkflowVersion] Could not unregister official workflows tab:", e);
    }

    // 2. Register our dedicated, fully-featured sidebar tab
    try {
      if (comfyApp.extensionManager && typeof comfyApp.extensionManager.registerSidebarTab === "function") {
        comfyApp.extensionManager.registerSidebarTab({
          id: "workflow-git-tab",
          icon: "wfg-tab-icon icon-[comfy--workflow]",
          title: "工作流管理",
          tooltip: "工作流版本与工程管理",
          type: "custom",
          render(el) {
            mountWorkflowGitPanel(el);
          },
          destroy() {
            unmountWorkflowGitPanel();
          }
        });
      }
    } catch (e) {
      console.error("[WorkflowVersion] Failed to register custom sidebar tab:", e);
    }

    // 3. Initial load of workflows
    await fetchWorkflowsList();

    // 4. Listen for graph modifications to run dirty check
    const originalAfterConfigure = comfyApp.graph?.afterConfigure;
    if (comfyApp.graph) {
      comfyApp.graph.afterConfigure = function (...args) {
        const ret = originalAfterConfigure ? originalAfterConfigure.apply(this, args) : undefined;
        syncActiveWorkflowFromComfy();
        setCleanBaseline(getNormalizedGraphData());
        return ret;
      };

      comfyApp.graph.onNodeAdded = () => triggerDirtyCheckDebounced();
      comfyApp.graph.onNodeRemoved = () => triggerDirtyCheckDebounced();
      comfyApp.graph.onConnectionChange = () => triggerDirtyCheckDebounced();
    }

    // 5. Periodic sync with active tab and dirty checking
    setInterval(() => {
      syncActiveWorkflowFromComfy();
      performDirtyCheck();
    }, 1000);
  }
});
