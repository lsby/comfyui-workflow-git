import os
from pathlib import Path

class ConfigManager:
    def __init__(self, plugin_dir: Path):
        self.plugin_dir = plugin_dir

    def resolve_workflows_dir(self) -> Path:
        """
        Always resolves to ComfyUI's native user workflows directory:
        ComfyUI/user/default/workflows
        """
        # custom_nodes/comfyui-workflow-git -> parent 0: custom_nodes -> parent 1: ComfyUI
        comfyui_root = self.plugin_dir.parents[1]
        workflows_dir = (comfyui_root / "user" / "default" / "workflows").resolve()
        workflows_dir.mkdir(parents=True, exist_ok=True)
        return workflows_dir

    def get_config(self) -> dict:
        return {
            "workflows_dir": self.get_relative_display_path(),
            "auto_git_init": True
        }

    def save_config(self, new_config: dict) -> bool:
        return True

    def get_relative_display_path(self) -> str:
        resolved = self.resolve_workflows_dir()
        try:
            rel = os.path.relpath(resolved, self.plugin_dir)
            return rel.replace("\\", "/")
        except Exception:
            return str(resolved)
