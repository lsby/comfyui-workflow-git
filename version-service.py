"""
Lightweight isolated version management service for ComfyUI workflows.
Stores per-workflow versions under .workflow_versions/<rel_path_stem>/
Supports nested directories and cross-folder file moves.
"""

import os
import json
import time
import shutil
import hashlib
import random
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple

class VersionService:
    def __init__(self, workflows_dir: Path):
        self.workflows_dir = Path(workflows_dir)
        self.storage_dir = self.workflows_dir / ".workflow_versions"
        self._ensure_storage_dir()

    def _ensure_storage_dir(self):
        try:
            self.storage_dir.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass

    def _clean_segment(self, segment: str) -> str:
        s = segment.strip()
        for char in '<>:"/\\|?*':
            s = s.replace(char, "_")
        return s

    def _get_rel_parts(self, file_path_str: str) -> List[str]:
        p_str = file_path_str.replace("\\", "/").strip("/")
        if p_str.lower().startswith("workflows/"):
            p_str = p_str[10:].strip("/")
        p = Path(p_str)
        parts = list(p.parts)
        if not parts:
            return ["workflow"]
        last = parts[-1]
        if last.lower().endswith(".json"):
            last = last[:-5]
        clean_parts = [self._clean_segment(part) for part in parts[:-1] if part.strip()]
        clean_last = self._clean_segment(last) or "workflow"
        clean_parts.append(clean_last)
        return clean_parts

    def _get_workflow_dir(self, file_name: str) -> Path:
        parts = self._get_rel_parts(file_name)
        folder = self.storage_dir / Path(*parts)
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "snapshots").mkdir(parents=True, exist_ok=True)
        return folder

    def save_version(self, file_name: str, workflow_json_str: str, message: str) -> Dict[str, Any]:
        """
        Save a version snapshot for a specific workflow file (supports nested paths).
        1. Save snapshot to .workflow_versions/<rel_stem>/snapshots/<id>.json
        2. Write active file to workflows/<rel_path>
        3. Update index.json
        """
        self._ensure_storage_dir()
        norm_rel = file_name.replace("\\", "/").strip("/")
        if norm_rel.lower().startswith("workflows/"):
            norm_rel = norm_rel[10:].strip("/")
        if not norm_rel.lower().endswith(".json"):
            norm_rel = f"{norm_rel}.json"

        # Ensure workflow JSON contains a valid version for ComfyUI schema validation
        try:
            parsed_data = json.loads(workflow_json_str)
            if isinstance(parsed_data, dict) and "version" not in parsed_data:
                parsed_data["version"] = 0.4
                workflow_json_str = json.dumps(parsed_data, indent=2, ensure_ascii=False)
        except Exception:
            pass

        wf_dir = self._get_workflow_dir(norm_rel)
        snapshots_dir = wf_dir / "snapshots"
        index_file = wf_dir / "index.json"

        # Generate unique 7-char hash ID
        seed = f"{time.time()}_{message}_{random.randint(1000, 9999)}_{norm_rel}"
        short_id = hashlib.sha1(seed.encode("utf-8")).hexdigest()[:7]

        # 1. Save snapshot JSON
        snapshot_file = snapshots_dir / f"{short_id}.json"
        with open(snapshot_file, "w", encoding="utf-8") as f:
            f.write(workflow_json_str)

        # 2. Update active file on disk
        active_file = self.workflows_dir / norm_rel
        try:
            active_file.parent.mkdir(parents=True, exist_ok=True)
            with open(active_file, "w", encoding="utf-8") as f:
                f.write(workflow_json_str)
        except Exception as e:
            print(f"[VersionService] Warning: failed to write active file {active_file}: {e}")

        # 3. Update index.json
        index_data: List[Dict[str, Any]] = []
        if index_file.exists():
            try:
                with open(index_file, "r", encoding="utf-8") as f:
                    index_data = json.load(f)
            except Exception:
                index_data = []

        record = {
            "id": short_id,
            "short_hash": short_id,
            "full_hash": short_id,
            "message": message.strip() or "未命名修改",
            "date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "file": norm_rel,
            "size": len(workflow_json_str.encode("utf-8"))
        }

        index_data.insert(0, record)

        with open(index_file, "w", encoding="utf-8") as f:
            json.dump(index_data, f, indent=2, ensure_ascii=False)

        return {
            "success": True,
            "commit_hash": short_id,
            "message": record["message"],
            "file": norm_rel
        }

    def _cleanup_empty_parents(self, start_dir: Path):
        """Recursively remove empty parent directories inside storage_dir."""
        try:
            curr = start_dir
            while curr != self.storage_dir and curr != curr.parent:
                if curr.is_dir() and not any(curr.iterdir()):
                    curr.rmdir()
                    curr = curr.parent
                else:
                    break
        except Exception:
            pass

    def rename_workflow(self, src_file: str, dst_file: str) -> bool:
        """
        Migrate version history when a workflow file or directory is renamed or moved
        (supports cross-folder and nested directory moves).
        """
        self._ensure_storage_dir()
        norm_src = src_file.replace("\\", "/").strip("/")
        norm_dst = dst_file.replace("\\", "/").strip("/")
        if norm_src.lower().startswith("workflows/"):
            norm_src = norm_src[10:].strip("/")
        if norm_dst.lower().startswith("workflows/"):
            norm_dst = norm_dst[10:].strip("/")

        if norm_src == norm_dst:
            return True

        # Check if src_file is a whole directory
        src_parts = [self._clean_segment(p) for p in norm_src.split("/") if p.strip()]
        dst_parts = [self._clean_segment(p) for p in norm_dst.split("/") if p.strip()]

        src_dir_candidate = self.storage_dir / Path(*src_parts)
        dst_dir_candidate = self.storage_dir / Path(*dst_parts)

        # 1. Directory rename case (if user renamed or moved an entire folder)
        if src_dir_candidate.is_dir() and not (src_dir_candidate / "snapshots").exists():
            try:
                dst_dir_candidate.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(src_dir_candidate), str(dst_dir_candidate))
                self._cleanup_empty_parents(src_dir_candidate.parent)
                # Update all index.json records inside this directory
                for idx_path in dst_dir_candidate.rglob("index.json"):
                    try:
                        with open(idx_path, "r", encoding="utf-8") as f:
                            records = json.load(f)
                        for r in records:
                            old_f = r.get("file", "")
                            if old_f.startswith(norm_src):
                                r["file"] = norm_dst + old_f[len(norm_src):]
                        with open(idx_path, "w", encoding="utf-8") as f:
                            json.dump(records, f, indent=2, ensure_ascii=False)
                    except Exception:
                        pass
                print(f"[WorkflowVersion] Migrated workflow directory: {norm_src} -> {norm_dst}")
                return True
            except Exception as e:
                print(f"[WorkflowVersion] Error migrating directory: {e}")

        # 2. Workflow file rename case (single workflow file moved or renamed)
        src_wf_dir = self.storage_dir / Path(*self._get_rel_parts(norm_src))
        dst_wf_dir = self.storage_dir / Path(*self._get_rel_parts(norm_dst))

        if not src_wf_dir.exists():
            return False

        try:
            clean_dst_name = norm_dst if norm_dst.lower().endswith(".json") else f"{norm_dst}.json"
            dst_wf_dir.parent.mkdir(parents=True, exist_ok=True)

            if not dst_wf_dir.exists():
                shutil.move(str(src_wf_dir), str(dst_wf_dir))
            else:
                # Merge snapshots
                dst_snapshots = dst_wf_dir / "snapshots"
                dst_snapshots.mkdir(parents=True, exist_ok=True)
                for snap in (src_wf_dir / "snapshots").iterdir():
                    if snap.is_file():
                        shutil.copy2(snap, dst_snapshots / snap.name)

                # Merge index.json
                src_idx = src_wf_dir / "index.json"
                dst_idx = dst_wf_dir / "index.json"
                src_items = []
                dst_items = []
                if src_idx.exists():
                    try:
                        with open(src_idx, "r", encoding="utf-8") as f:
                            src_items = json.load(f)
                    except Exception:
                        pass
                if dst_idx.exists():
                    try:
                        with open(dst_idx, "r", encoding="utf-8") as f:
                            dst_items = json.load(f)
                    except Exception:
                        pass

                merged_items = src_items + dst_items
                seen = set()
                unique_items = []
                for it in merged_items:
                    hid = it.get("short_hash") or it.get("id")
                    if hid not in seen:
                        seen.add(hid)
                        unique_items.append(it)
                unique_items.sort(key=lambda x: x.get("date", ""), reverse=True)
                with open(dst_idx, "w", encoding="utf-8") as f:
                    json.dump(unique_items, f, indent=2, ensure_ascii=False)

                shutil.rmtree(src_wf_dir, ignore_errors=True)

            self._cleanup_empty_parents(src_wf_dir.parent)

            # Update records' "file" in dst_wf_dir / index.json
            idx_file = dst_wf_dir / "index.json"
            if idx_file.exists():
                with open(idx_file, "r", encoding="utf-8") as f:
                    items = json.load(f)
                for it in items:
                    it["file"] = clean_dst_name
                with open(idx_file, "w", encoding="utf-8") as f:
                    json.dump(items, f, indent=2, ensure_ascii=False)

            print(f"[WorkflowVersion] Successfully renamed workflow history: {norm_src} -> {norm_dst}")
            return True
        except Exception as e:
            print(f"[WorkflowVersion] Error renaming workflow history: {e}")
            return False

    def _try_auto_migrate_renamed_history(self, current_file_name: str) -> bool:
        """
        Auto-heal: If current_file_name has no history directory, check if any orphaned
        history directory in .workflow_versions belongs to an old file that no longer exists on disk.
        """
        try:
            norm_curr = current_file_name.replace("\\", "/").strip("/")
            if norm_curr.lower().startswith("workflows/"):
                norm_curr = norm_curr[10:].strip("/")
            curr_path = self.workflows_dir / (norm_curr if norm_curr.lower().endswith(".json") else f"{norm_curr}.json")
            if not curr_path.exists():
                return False

            try:
                with open(curr_path, "r", encoding="utf-8") as f:
                    curr_data = json.load(f)
                curr_nodes_count = len(curr_data.get("nodes", []))
            except Exception:
                curr_nodes_count = -1

            candidate_dir = None
            candidate_old_file = None

            for idx_file in self.storage_dir.rglob("index.json"):
                folder = idx_file.parent
                try:
                    with open(idx_file, "r", encoding="utf-8") as f:
                        items = json.load(f)
                    if items:
                        old_file = items[0].get("file")
                        if old_file:
                            old_path = self.workflows_dir / old_file
                            if not old_path.exists():
                                latest_id = items[0].get("id") or items[0].get("short_hash")
                                snap_file = folder / "snapshots" / f"{latest_id}.json"
                                if snap_file.exists():
                                    try:
                                        with open(snap_file, "r", encoding="utf-8") as sf:
                                            snap_data = json.load(sf)
                                        snap_nodes = len(snap_data.get("nodes", []))
                                        if snap_nodes == curr_nodes_count or curr_nodes_count <= 0:
                                            candidate_dir = folder
                                            candidate_old_file = old_file
                                            break
                                    except Exception:
                                        pass
                                if not candidate_dir:
                                    candidate_dir = folder
                                    candidate_old_file = old_file
                except Exception:
                    pass

            if candidate_dir and candidate_old_file:
                print(f"[WorkflowVersion] Auto-migrating orphaned history for {candidate_old_file} -> {norm_curr}")
                return self.rename_workflow(candidate_old_file, norm_curr)
        except Exception as e:
            print(f"[WorkflowVersion] Error in auto-migrate history: {e}")
        return False

    def get_history(self, file_name: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
        """
        Get version history for a specific workflow file or all workflows.
        """
        self._ensure_storage_dir()
        if file_name:
            norm_name = file_name.replace("\\", "/").strip("/")
            if norm_name.lower().startswith("workflows/"):
                norm_name = norm_name[10:].strip("/")

            parts = self._get_rel_parts(norm_name)
            wf_dir = self.storage_dir / Path(*parts)
            index_file = wf_dir / "index.json"

            if not index_file.exists():
                # Fallback search by base stem across nested folders
                base_stem = parts[-1]
                matches = list(self.storage_dir.rglob(f"{base_stem}/index.json"))
                if matches:
                    index_file = matches[0]
                    wf_dir = index_file.parent
                else:
                    self._try_auto_migrate_renamed_history(norm_name)
                    if (wf_dir / "index.json").exists():
                        index_file = wf_dir / "index.json"

            if not index_file.exists():
                return []
            try:
                with open(index_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    return data[:limit]
            except Exception:
                return []
        else:
            all_records = []
            for idx in self.storage_dir.rglob("index.json"):
                try:
                    with open(idx, "r", encoding="utf-8") as f:
                        all_records.extend(json.load(f))
                except Exception:
                    pass
            all_records.sort(key=lambda x: x.get("date", ""), reverse=True)
            return all_records[:limit]

    def get_file_content_at_version(self, short_id: str, file_name: Optional[str] = None) -> Optional[Tuple[str, str]]:
        """
        Retrieve workflow JSON at specific version and sync back to active file on disk.
        """
        self._ensure_storage_dir()
        snapshot_path: Optional[Path] = None
        actual_name = file_name or "workflow.json"
        if actual_name.replace("\\", "/").lower().startswith("workflows/"):
            actual_name = actual_name.replace("\\", "/")[10:].strip("/")

        # Search in file_name directory first
        if file_name:
            wf_dir = self.storage_dir / Path(*self._get_rel_parts(file_name))
            candidate = wf_dir / "snapshots" / f"{short_id}.json"
            if candidate.exists():
                snapshot_path = candidate

        # Fallback search across all workflow snapshot dirs
        if not snapshot_path or not snapshot_path.exists():
            candidates = list(self.storage_dir.rglob(f"snapshots/{short_id}.json"))
            if candidates:
                snapshot_path = candidates[0]
                idx_file = snapshot_path.parent.parent / "index.json"
                if idx_file.exists():
                    try:
                        with open(idx_file, "r", encoding="utf-8") as f:
                            recs = json.load(f)
                        if recs and recs[0].get("file"):
                            actual_name = recs[0]["file"]
                    except Exception:
                        pass

        if not snapshot_path or not snapshot_path.exists():
            return None

        with open(snapshot_path, "r", encoding="utf-8") as f:
            content = f.read()

        # Sync back to active file on disk
        try:
            active_file = self.workflows_dir / actual_name
            active_file.parent.mkdir(parents=True, exist_ok=True)
            with open(active_file, "w", encoding="utf-8") as f:
                f.write(content)
        except Exception as e:
            print(f"[VersionService] Warning: failed to sync restored file {actual_name}: {e}")

        return (actual_name, content)

    def delete_version(self, short_id: str, file_name: str) -> bool:
        """
        Delete a single version snapshot and remove from index.
        """
        self._ensure_storage_dir()
        wf_dir = self.storage_dir / Path(*self._get_rel_parts(file_name))
        index_file = wf_dir / "index.json"
        snapshot_file = wf_dir / "snapshots" / f"{short_id}.json"

        if not snapshot_file.exists():
            candidates = list(self.storage_dir.rglob(f"snapshots/{short_id}.json"))
            if candidates:
                snapshot_file = candidates[0]
                index_file = snapshot_file.parent.parent / "index.json"

        if snapshot_file.exists():
            try:
                snapshot_file.unlink()
            except Exception:
                pass

        if index_file.exists():
            try:
                with open(index_file, "r", encoding="utf-8") as f:
                    index_data = json.load(f)
                index_data = [item for item in index_data if item.get("id") != short_id and item.get("short_hash") != short_id]
                with open(index_file, "w", encoding="utf-8") as f:
                    json.dump(index_data, f, indent=2, ensure_ascii=False)
            except Exception as e:
                print(f"[VersionService] Failed to update index on delete: {e}")
                return False

        return True

    def get_status(self) -> Dict[str, Any]:
        return {
            "active": True,
            "engine": "lightweight-snapshot",
            "branch": "本地快照库",
            "storage_path": str(self.storage_dir)
        }
