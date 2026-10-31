import json
from aiohttp import web
from pathlib import Path
from typing import Any

def register_api_routes(app: web.Application, git_service, config_manager):
    routes = web.RouteTableDef()

    @routes.get("/workflow-git/status")
    async def get_status(request):
        try:
            git_service.target_dir = config_manager.resolve_workflows_dir()
            status = git_service.get_status()
            config = config_manager.get_config()
            return web.json_response({
                "success": True,
                "status": status,
                "config": config,
                "resolved_dir": str(git_service.target_dir)
            })
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @routes.post("/workflow-git/init")
    async def init_repository(request):
        try:
            git_service.target_dir = config_manager.resolve_workflows_dir()
            res = git_service.init_repo()
            return web.json_response(res)
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @routes.post("/workflow-git/commit")
    async def commit_workflow(request):
        try:
            git_service.target_dir = config_manager.resolve_workflows_dir()
            data = await request.json()
            file_name = data.get("file_name", "workflow.json").strip()
            workflow_data = data.get("workflow", {})
            message = data.get("message", "").strip()

            if isinstance(workflow_data, dict):
                workflow_json_str = json.dumps(workflow_data, indent=2, ensure_ascii=False)
            else:
                workflow_json_str = str(workflow_data)

            res = git_service.save_and_commit(file_name, workflow_json_str, message)
            return web.json_response(res)
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @routes.get("/workflow-git/history")
    async def get_history(request):
        try:
            git_service.target_dir = config_manager.resolve_workflows_dir()
            file_name = request.query.get("file", None)
            if file_name:
                file_name = file_name.strip()
            limit = int(request.query.get("limit", 50))
            history = git_service.get_history(file_name=file_name, limit=limit)
            return web.json_response({"success": True, "history": history})
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @routes.get("/workflow-git/checkout")
    async def checkout_file(request):
        try:
            git_service.target_dir = config_manager.resolve_workflows_dir()
            commit_hash = request.query.get("hash", "").strip()
            file_name = request.query.get("file", "").strip() or None
            if not commit_hash:
                return web.json_response({"success": False, "error": "Missing commit hash parameter"}, status=400)

            result = git_service.get_file_content_at_commit(commit_hash, file_name)
            if result is None:
                return web.json_response({"success": False, "error": "Workflow file or commit not found in repository"}, status=404)

            actual_file, content = result
            try:
                parsed = json.loads(content)
                return web.json_response({"success": True, "file": actual_file, "workflow": parsed})
            except Exception:
                return web.json_response({"success": True, "file": actual_file, "raw_content": content})
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @routes.get("/workflow-git/files")
    async def list_files(request):
        try:
            git_service.target_dir = config_manager.resolve_workflows_dir()
            files = git_service.list_workflow_files()
            return web.json_response({"success": True, "files": files})
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @routes.get("/workflow-git/config")
    async def get_plugin_config(request):
        try:
            cfg = config_manager.get_config()
            resolved = str(config_manager.resolve_workflows_dir())
            return web.json_response({"success": True, "config": cfg, "resolved_path": resolved})
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @routes.post("/workflow-git/config")
    async def update_plugin_config(request):
        try:
            return web.json_response({"success": True, "config": config_manager.get_config()})
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)

    app.add_routes(routes)
