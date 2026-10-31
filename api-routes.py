import json
import shutil
import urllib.parse
from aiohttp import web
from pathlib import Path
from typing import Any

def register_api_routes(app: web.Application, version_service, config_manager):
    routes = web.RouteTableDef()

    @routes.get("/workflow-git/status")
    async def get_status(request):
        try:
            version_service.workflows_dir = config_manager.resolve_workflows_dir()
            version_service.storage_dir = version_service.workflows_dir / ".workflow_versions"
            status = version_service.get_status()
            config = config_manager.get_config()
            return web.json_response({
                "success": True,
                "status": status,
                "config": config,
                "resolved_dir": str(version_service.workflows_dir)
            })
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @routes.post("/workflow-git/commit")
    async def commit_workflow(request):
        try:
            version_service.workflows_dir = config_manager.resolve_workflows_dir()
            version_service.storage_dir = version_service.workflows_dir / ".workflow_versions"
            data = await request.json()
            file_name = data.get("file_name", "workflow.json").strip()
            workflow_data = data.get("workflow", {})
            message = data.get("message", "").strip()

            if isinstance(workflow_data, dict):
                workflow_json_str = json.dumps(workflow_data, indent=2, ensure_ascii=False)
            else:
                workflow_json_str = str(workflow_data)

            res = version_service.save_version(file_name, workflow_json_str, message)
            return web.json_response(res)
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @routes.get("/workflow-git/history")
    async def get_history(request):
        try:
            version_service.workflows_dir = config_manager.resolve_workflows_dir()
            version_service.storage_dir = version_service.workflows_dir / ".workflow_versions"
            file_name = request.query.get("file", None)
            if file_name:
                file_name = file_name.strip()
            limit = int(request.query.get("limit", 100))
            history = version_service.get_history(file_name=file_name, limit=limit)
            return web.json_response({"success": True, "history": history})
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @routes.get("/workflow-git/checkout")
    async def checkout_file(request):
        try:
            version_service.workflows_dir = config_manager.resolve_workflows_dir()
            version_service.storage_dir = version_service.workflows_dir / ".workflow_versions"
            short_id = request.query.get("hash", "").strip()
            file_name = request.query.get("file", "").strip() or None
            if not short_id:
                return web.json_response({"success": False, "error": "Missing version hash parameter"}, status=400)

            result = version_service.get_file_content_at_version(short_id, file_name)
            if result is None:
                return web.json_response({"success": False, "error": "Version snapshot not found"}, status=404)

            actual_file, content = result
            try:
                parsed = json.loads(content)
                return web.json_response({"success": True, "file": actual_file, "workflow": parsed})
            except Exception:
                return web.json_response({"success": True, "file": actual_file, "raw_content": content})
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @routes.post("/workflow-git/delete")
    async def delete_version(request):
        try:
            version_service.workflows_dir = config_manager.resolve_workflows_dir()
            version_service.storage_dir = version_service.workflows_dir / ".workflow_versions"
            data = await request.json()
            short_id = data.get("hash", "").strip()
            file_name = data.get("file_name", "").strip()
            if not short_id or not file_name:
                return web.json_response({"success": False, "error": "Missing hash or file_name"}, status=400)

            ok = version_service.delete_version(short_id, file_name)
            return web.json_response({"success": ok})
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @routes.post("/workflow-git/rename")
    async def rename_workflow_endpoint(request):
        try:
            version_service.workflows_dir = config_manager.resolve_workflows_dir()
            version_service.storage_dir = version_service.workflows_dir / ".workflow_versions"
            data = await request.json()
            src = data.get("src", "").strip()
            dst = data.get("dst", "").strip()
            if not src or not dst:
                return web.json_response({"success": False, "error": "Missing src or dst parameters"}, status=400)

            ok = version_service.rename_workflow(src, dst)
            return web.json_response({"success": ok})
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @routes.get("/workflow-git/folders")
    async def list_folders_endpoint(request):
        try:
            wf_dir = config_manager.resolve_workflows_dir()
            folders = []
            for p in wf_dir.rglob("*"):
                if p.is_dir():
                    rel_parts = p.relative_to(wf_dir).parts
                    if not any(part.startswith(".") for part in rel_parts):
                        folders.append(p.relative_to(wf_dir).as_posix())
            folders.sort()
            return web.json_response({"success": True, "folders": folders})
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @routes.post("/workflow-git/folder/create")
    async def create_folder_endpoint(request):
        try:
            wf_dir = config_manager.resolve_workflows_dir()
            data = await request.json()
            folder_name = data.get("folder", "").replace("\\", "/").strip("/")
            if not folder_name:
                return web.json_response({"success": False, "error": "Folder name required"}, status=400)

            target_dir = wf_dir / folder_name
            target_dir.mkdir(parents=True, exist_ok=True)
            return web.json_response({"success": True, "folder": folder_name})
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @routes.post("/workflow-git/folder/rename")
    async def rename_folder_endpoint(request):
        try:
            wf_dir = config_manager.resolve_workflows_dir()
            version_service.workflows_dir = wf_dir
            version_service.storage_dir = wf_dir / ".workflow_versions"
            data = await request.json()
            src = data.get("src", "").replace("\\", "/").strip("/")
            dst = data.get("dst", "").replace("\\", "/").strip("/")
            if not src or not dst:
                return web.json_response({"success": False, "error": "Missing src or dst"}, status=400)

            src_path = wf_dir / src
            dst_path = wf_dir / dst
            if not src_path.exists() or not src_path.is_dir():
                return web.json_response({"success": False, "error": f"Folder {src} not found"}, status=404)

            dst_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src_path), str(dst_path))

            # Migrate version history
            version_service.rename_workflow(src, dst)
            return web.json_response({"success": True, "src": src, "dst": dst})
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @routes.post("/workflow-git/folder/delete")
    async def delete_folder_endpoint(request):
        try:
            wf_dir = config_manager.resolve_workflows_dir()
            storage_dir = wf_dir / ".workflow_versions"
            data = await request.json()
            folder = data.get("folder", "").replace("\\", "/").strip("/")
            if not folder:
                return web.json_response({"success": False, "error": "Folder name required"}, status=400)

            target = wf_dir / folder
            if target.exists() and target.is_dir():
                shutil.rmtree(str(target), ignore_errors=True)

            target_storage = storage_dir / folder
            if target_storage.exists():
                shutil.rmtree(str(target_storage), ignore_errors=True)

            return web.json_response({"success": True})
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @routes.post("/workflow-git/move")
    async def move_item_endpoint(request):
        try:
            wf_dir = config_manager.resolve_workflows_dir()
            version_service.workflows_dir = wf_dir
            version_service.storage_dir = wf_dir / ".workflow_versions"
            data = await request.json()
            src = data.get("src", "").replace("\\", "/").strip("/")
            dst = data.get("dst", "").replace("\\", "/").strip("/")
            if not src or not dst:
                return web.json_response({"success": False, "error": "Missing src or dst"}, status=400)

            src_path = wf_dir / src
            dst_path = wf_dir / dst
            if not src_path.exists():
                return web.json_response({"success": False, "error": f"Source file {src} not found"}, status=404)

            dst_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src_path), str(dst_path))

            # Migrate version history
            version_service.rename_workflow(src, dst)
            return web.json_response({"success": True, "src": src, "dst": dst})
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

    # Middleware to automatically intercept moves, and enrich /userdata with true empty folders
    @web.middleware
    async def workflow_interceptor_middleware(request, handler):
        response = await handler(request)

        # 1. Intercept file/folder move operations
        if response.status == 200 and request.method == "POST" and "/userdata/" in request.path and "/move/" in request.path:
            try:
                src_param = request.match_info.get("file", "")
                dest_param = request.match_info.get("dest", "")
                src = urllib.parse.unquote(src_param).replace("\\", "/").strip("/")
                dest = urllib.parse.unquote(dest_param).replace("\\", "/").strip("/")
                if "workflows" in src and "workflows" in dest:
                    def get_rel(p: str) -> str:
                        if "workflows/" in p:
                            return p.split("workflows/", 1)[1]
                        return p

                    src_rel = get_rel(src)
                    dest_rel = get_rel(dest)
                    if src_rel and dest_rel:
                        version_service.workflows_dir = config_manager.resolve_workflows_dir()
                        version_service.storage_dir = version_service.workflows_dir / ".workflow_versions"
                        version_service.rename_workflow(src_rel, dest_rel)
            except Exception as e:
                print(f"[WorkflowVersion] Error in rename interceptor: {e}")

        # 2. Enrich GET /userdata with true empty folders (ending with /)
        if response.status == 200 and request.method == "GET" and request.path == "/userdata" and request.query.get("dir") == "workflows":
            try:
                wf_dir = config_manager.resolve_workflows_dir()
                body_text = response.text
                items = json.loads(body_text)
                if isinstance(items, list):
                    dirs = []
                    for p in wf_dir.rglob("*"):
                        if p.is_dir():
                            rel_parts = p.relative_to(wf_dir).parts
                            if not any(part.startswith(".") for part in rel_parts):
                                dirs.append(p.relative_to(wf_dir).as_posix())

                    for d in dirs:
                        prefix = f"{d}/"
                        has_files = any(f.get("path", "").startswith(prefix) for f in items if isinstance(f, dict))
                        if not has_files:
                            try:
                                mtime = (wf_dir / d).stat().st_mtime
                            except Exception:
                                mtime = 0
                            items.append({
                                "path": prefix,
                                "size": 0,
                                "modified": mtime,
                                "created": mtime
                            })
                    return web.json_response(items)
            except Exception as e:
                print(f"[WorkflowVersion] Error enriching empty folders: {e}")

        return response

    if workflow_interceptor_middleware not in app.middlewares:
        app.middlewares.append(workflow_interceptor_middleware)

    app.add_routes(routes)
