import json
import os
from pathlib import Path

DEFAULT_CONFIG = {
    "workflows_dir": "",
    "auto_git_init": True
}

class ConfigManager:
    def __init__(self, plugin_dir: Path):
        self.plugin_dir = plugin_dir
        self.config_path = plugin_dir / "config.json"
        self._ensure_config()

    def _ensure_config(self):
        if not self.config_path.exists():
            self.save_config(DEFAULT_CONFIG)

    def get_config(self) -> dict:
        try:
            if self.config_path.exists():
                with open(self.config_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    config = dict(DEFAULT_CONFIG)
                    config.update(data)
                    return config
        except Exception as e:
            print(f"[WorkflowGit] Failed to read config: {e}")
        return dict(DEFAULT_CONFIG)

    def save_config(self, new_config: dict) -> bool:
        try:
            with open(self.config_path, "w", encoding="utf-8") as f:
                json.dump(new_config, f, indent=2, ensure_ascii=False)
            return True
        except Exception as e:
            print(f"[WorkflowGit] Failed to save config: {e}")
            return False

    def resolve_workflows_dir(self) -> Path:
        config = self.get_config()
        raw_path = config.get("workflows_dir", "").strip()
        
        # 1. If explicit config exists and target folder exists, use it
        if raw_path:
            p = Path(raw_path)
            resolved = (self.plugin_dir / p).resolve() if not p.is_absolute() else p.resolve()
            if resolved.exists():
                return resolved

        # 2. Auto-detect: search upwards for custom '工作流' folder first (highest priority)
        for parent in self.plugin_dir.parents:
            candidate = parent / "工作流"
            if candidate.exists() and candidate.is_dir():
                return candidate.resolve()

        # 3. Next search for 'workflows' or ComfyUI user workflows
        for parent in self.plugin_dir.parents:
            candidate = parent / "workflows"
            if candidate.exists() and candidate.is_dir():
                return candidate.resolve()
            candidate_user = parent / "user" / "default" / "workflows"
            if candidate_user.exists() and candidate_user.is_dir():
                return candidate_user.resolve()

        # 4. Fallback
        return (self.plugin_dir.parents[2] / "工作流").resolve()

    def get_relative_or_absolute_display_path(self) -> str:
        resolved = self.resolve_workflows_dir()
        try:
            rel = os.path.relpath(resolved, self.plugin_dir)
            return rel.replace("\\", "/")
        except Exception:
            return str(resolved)
