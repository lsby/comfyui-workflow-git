import json
import os
from pathlib import Path

DEFAULT_CONFIG = {
    "workflows_dir": "../../工作流",
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
        raw_path = config.get("workflows_dir", "../../工作流")
        
        # If relative path, resolve relative to ComfyUI root (or plugin parent)
        path_obj = Path(raw_path)
        if not path_obj.is_absolute():
            resolved = (self.plugin_dir / path_obj).resolve()
        else:
            resolved = path_obj.resolve()
            
        return resolved
