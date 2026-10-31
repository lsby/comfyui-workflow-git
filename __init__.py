"""
ComfyUI Workflow Version Control - Lightweight native version snapshot manager for workflows.
"""
import os
import sys
import importlib.util
from pathlib import Path

# Setup paths
PLUGIN_DIR = Path(__file__).parent.resolve()
WEB_DIRECTORY = "./web"

def _import_by_path(name: str, file_path: Path):
    spec = importlib.util.spec_from_file_location(name, str(file_path))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module

try:
    # Load submodules using dynamic import to support kebab-case filenames
    config_manager_mod = _import_by_path("config_manager", PLUGIN_DIR / "config-manager.py")
    version_service_mod = _import_by_path("version_service", PLUGIN_DIR / "version-service.py")
    api_routes_mod = _import_by_path("api_routes", PLUGIN_DIR / "api-routes.py")

    ConfigManager = config_manager_mod.ConfigManager
    VersionService = version_service_mod.VersionService
    register_api_routes = api_routes_mod.register_api_routes

    # Initialize managers
    config_mgr = ConfigManager(PLUGIN_DIR)
    workflows_dir = config_mgr.resolve_workflows_dir()
    version_srv = VersionService(workflows_dir)

    # Register API to ComfyUI PromptServer
    try:
        import server
        if hasattr(server, "PromptServer") and server.PromptServer.instance is not None:
            register_api_routes(server.PromptServer.instance.app, version_srv, config_mgr)
            print(f"[WorkflowVersion] Loaded successfully. Workflows directory: {workflows_dir}")
    except Exception as e:
        print(f"[WorkflowVersion] Failed to register routes on server: {e}")

except Exception as e:
    print(f"[WorkflowVersion] Initialization error: {e}")

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
