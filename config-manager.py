import json
import os
from pathlib import Path

DEFAULT_CONFIG = {
    "workflows_dir": "../../user/default/workflows",
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

        # 1. Check if user configured a non-default custom path
        if raw_path and raw_path != DEFAULT_CONFIG["workflows_dir"]:
            p = Path(raw_path)
            resolved = (self.plugin_dir / p).resolve() if not p.is_absolute() else p.resolve()
            return resolved

        # 2. Priority: ComfyUI native user workflows folder (../../user/default/workflows)
        # Structure: custom_nodes/comfyui-workflow-git -> ComfyUI -> user/default/workflows
        comfyui_root = self.plugin_dir.parents[1]
        native_workflows = comfyui_root / "user" / "default" / "workflows"
        if not native_workflows.exists():
            native_workflows.mkdir(parents=True, exist_ok=True)
        return native_workflows.resolve()

    def get_relative_or_absolute_display_path(self) -> str:
        resolved = self.resolve_workflows_dir()
        try:
            rel = os.path.relpath(resolved, self.plugin_dir)
            return rel.replace("\\", "/")
        except Exception:
            return str(resolved)
