import os
import json
import time
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
        # Remove .json extension if present for directory name
        if name.lower().endswith(".json"):
            name = name[:-5]
        # Clean illegal characters in folder name on Windows
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

        # Prepend to list (latest first)
        index_data.insert(0, record)

        with open(index_file, "w", encoding="utf-8") as f:
            json.dump(index_data, f, indent=2, ensure_ascii=False)

        return {
            "success": True,
            "commit_hash": short_id,
            "message": record["message"],
            "file": file_name
        }

    def get_history(self, file_name: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
        """
        Get version history for a specific workflow file or all workflows.
        """
        self._ensure_storage_dir()
        if file_name:
            stem = self._get_workflow_stem(file_name)
            index_file = self.storage_dir / stem / "index.json"
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
                if item.is_dir():
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
                if folder.is_dir():
                    candidate = folder / "snapshots" / f"{short_id}.json"
                    if candidate.exists():
                        snapshot_path = candidate
                        actual_name = f"{folder.name}.json"
                        break

        if not snapshot_path or not snapshot_path.exists():
            return None

        with open(snapshot_path, "r", encoding="utf-8") as f:
            content = f.read()

        # Sync back to active file on disk so the current workflow file is updated
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

        # 1. Remove snapshot file
        if snapshot_file.exists():
            try:
                snapshot_file.unlink()
            except Exception:
                pass

        # 2. Remove entry from index.json
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
