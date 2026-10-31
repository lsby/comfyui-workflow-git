import os
import json
import time
import shutil
import hashlib
import random
from datetime import datetime
from pathlib import Path
from typing import Optional, Tuple, List, Dict, Any

class VersionService:
    def __init__(self, workflows_dir: Path):
        self.workflows_dir = workflows_dir
        self.storage_dir = self.workflows_dir / ".workflow_versions"
        self._ensure_storage_dir()

    def _ensure_storage_dir(self):
        try:
            self.storage_dir.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass

    def _get_workflow_stem(self, file_name: str) -> str:
        name = file_name.strip()
        if not name:
            name = "workflow"
        if name.lower().endswith(".json"):
            name = name[:-5]
        for char in '<>:"/\\|?*':
            name = name.replace(char, "_")
        return name

    def _get_workflow_dir(self, file_name: str) -> Path:
        stem = self._get_workflow_stem(file_name)
        folder = self.storage_dir / stem
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "snapshots").mkdir(parents=True, exist_ok=True)
        return folder

    def save_version(self, file_name: str, workflow_json_str: str, message: str) -> Dict[str, Any]:
        """
        Save a version snapshot for a specific workflow file.
        1. Save snapshot to .workflow_versions/<stem>/snapshots/<id>.json
        2. Write active file to workflows/<file_name>
        3. Update index.json
        """
        self._ensure_storage_dir()
        file_name = file_name.strip()
        if not file_name.lower().endswith(".json"):
            file_name = f"{file_name}.json"

        wf_dir = self._get_workflow_dir(file_name)
        snapshots_dir = wf_dir / "snapshots"
        index_file = wf_dir / "index.json"

        # Generate unique 7-char hash ID
        seed = f"{time.time()}_{message}_{random.randint(1000, 9999)}_{file_name}"
        short_id = hashlib.sha1(seed.encode("utf-8")).hexdigest()[:7]

        # 1. Save snapshot JSON
        snapshot_file = snapshots_dir / f"{short_id}.json"
        with open(snapshot_file, "w", encoding="utf-8") as f:
            f.write(workflow_json_str)

        # 2. Update active file on disk
        active_file = self.workflows_dir / file_name
        try:
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
            "file": file_name,
            "size": len(workflow_json_str.encode("utf-8"))
        }

        index_data.insert(0, record)

        with open(index_file, "w", encoding="utf-8") as f:
            json.dump(index_data, f, indent=2, ensure_ascii=False)

        return {
            "success": True,
            "commit_hash": short_id,
            "message": record["message"],
            "file": file_name
        }

    def rename_workflow(self, src_file: str, dst_file: str) -> bool:
        """
        Migrate version history when a workflow file is renamed in ComfyUI or externally.
        """
        self._ensure_storage_dir()
        src_stem = self._get_workflow_stem(src_file)
        dst_stem = self._get_workflow_stem(dst_file)

        if src_stem == dst_stem:
            return True

        src_dir = self.storage_dir / src_stem
        dst_dir = self.storage_dir / dst_stem

        if not src_dir.exists():
            return False

        try:
            clean_dst_name = dst_file if dst_file.lower().endswith(".json") else f"{dst_file}.json"

            if not dst_dir.exists():
                src_dir.rename(dst_dir)
            else:
                # Merge snapshots
                dst_snapshots = dst_dir / "snapshots"
                dst_snapshots.mkdir(parents=True, exist_ok=True)
                for snap in (src_dir / "snapshots").iterdir():
                    if snap.is_file():
                        shutil.copy2(snap, dst_snapshots / snap.name)

                # Merge index.json
                src_idx_file = src_dir / "index.json"
                dst_idx_file = dst_dir / "index.json"
                src_items = []
                dst_items = []
                if src_idx_file.exists():
                    try:
                        with open(src_idx_file, "r", encoding="utf-8") as f:
                            src_items = json.load(f)
                    except Exception:
                        pass
                if dst_idx_file.exists():
                    try:
                        with open(dst_idx_file, "r", encoding="utf-8") as f:
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
                with open(dst_idx_file, "w", encoding="utf-8") as f:
                    json.dump(unique_items, f, indent=2, ensure_ascii=False)

                shutil.rmtree(src_dir, ignore_errors=True)

            # Update all records' "file" field in dst_dir / index.json
            idx_file = dst_dir / "index.json"
            if idx_file.exists():
                with open(idx_file, "r", encoding="utf-8") as f:
                    items = json.load(f)
                for it in items:
                    it["file"] = clean_dst_name
                with open(idx_file, "w", encoding="utf-8") as f:
                    json.dump(items, f, indent=2, ensure_ascii=False)

            print(f"[WorkflowVersion] Successfully renamed workflow history: {src_stem} -> {dst_stem}")
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
            curr_path = self.workflows_dir / (current_file_name if current_file_name.lower().endswith(".json") else f"{current_file_name}.json")
            if not curr_path.exists():
                return False

            # Read current file to compare
            try:
                with open(curr_path, "r", encoding="utf-8") as f:
                    curr_data = json.load(f)
                curr_nodes_count = len(curr_data.get("nodes", []))
            except Exception:
                curr_nodes_count = -1

            candidate_dir = None
            candidate_old_file = None

            for folder in self.storage_dir.iterdir():
                if folder.is_dir() and not folder.name.startswith("."):
                    idx_file = folder / "index.json"
                    if idx_file.exists():
                        try:
                            with open(idx_file, "r", encoding="utf-8") as f:
                                items = json.load(f)
                            if items:
                                old_file = items[0].get("file")
                                if old_file:
                                    old_path = self.workflows_dir / old_file
                                    # If the old file recorded in this history folder NO LONGER EXISTS on disk:
                                    if not old_path.exists():
                                        # Check if the latest snapshot matches the current file
                                        latest_id = items[0].get("id") or items[0].get("short_hash")
                                        snap_file = folder / "snapshots" / f"{latest_id}.json"
                                        if snap_file.exists():
                                            try:
                                                with open(snap_file, "r", encoding="utf-8") as sf:
                                                    snap_data = json.load(sf)
                                                # Match by node count or structural similarity
                                                snap_nodes_count = len(snap_data.get("nodes", []))
                                                if snap_nodes_count == curr_nodes_count or curr_nodes_count <= 0:
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
                print(f"[WorkflowVersion] Auto-migrating orphaned history for {candidate_old_file} -> {current_file_name}")
                return self.rename_workflow(candidate_old_file, current_file_name)
        except Exception as e:
            print(f"[WorkflowVersion] Error in auto-migrate history: {e}")
        return False

    def get_history(self, file_name: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
        """
        Get version history for a specific workflow file or all workflows.
        Includes automatic history migration if file was renamed.
        """
        self._ensure_storage_dir()
        if file_name:
            stem = self._get_workflow_stem(file_name)
            index_file = self.storage_dir / stem / "index.json"

            # Auto-healing: If folder doesn't exist yet, check if it was renamed
            if not index_file.exists():
                self._try_auto_migrate_renamed_history(file_name)

            if not index_file.exists():
                return []
            try:
                with open(index_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    return data[:limit]
            except Exception:
                return []
        else:
            # Aggregate all histories
            all_records = []
            for item in self.storage_dir.iterdir():
                if item.is_dir() and not item.name.startswith("."):
                    idx = item / "index.json"
                    if idx.exists():
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

        # Search in file_name directory first
        if file_name:
            stem = self._get_workflow_stem(file_name)
            candidate = self.storage_dir / stem / "snapshots" / f"{short_id}.json"
            if candidate.exists():
                snapshot_path = candidate
                actual_name = file_name

        # Fallback search across all workflow snapshot dirs
        if not snapshot_path or not snapshot_path.exists():
            for folder in self.storage_dir.iterdir():
                if folder.is_dir() and not folder.name.startswith("."):
                    candidate = folder / "snapshots" / f"{short_id}.json"
                    if candidate.exists():
                        snapshot_path = candidate
                        actual_name = f"{folder.name}.json"
                        break

        if not snapshot_path or not snapshot_path.exists():
            return None

        with open(snapshot_path, "r", encoding="utf-8") as f:
            content = f.read()

        # Sync back to active file on disk
        try:
            active_file = self.workflows_dir / actual_name
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
        stem = self._get_workflow_stem(file_name)
        wf_dir = self.storage_dir / stem
        index_file = wf_dir / "index.json"
        snapshot_file = wf_dir / "snapshots" / f"{short_id}.json"

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
