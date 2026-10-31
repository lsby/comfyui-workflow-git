import subprocess
import os
import json
from pathlib import Path
from typing import Optional, List, Dict, Any

class GitService:
    def __init__(self, target_dir: Path):
        self.target_dir = target_dir

    def _run_git(self, args: List[str]) -> subprocess.CompletedProcess:
        """Run a git command in the target directory."""
        self.target_dir.mkdir(parents=True, exist_ok=True)
        return subprocess.run(
            ["git"] + args,
            cwd=str(self.target_dir),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace"
        )

    def is_git_available(self) -> bool:
        try:
            res = subprocess.run(
                ["git", "--version"],
                capture_output=True,
                text=True
            )
            return res.returncode == 0
        except Exception:
            return False

    def is_repo(self) -> bool:
        if not self.target_dir.exists():
            return False
        res = self._run_git(["rev-parse", "--is-inside-work-tree"])
        return res.returncode == 0 and res.stdout.strip() == "true"

    def init_repo(self) -> Dict[str, Any]:
        self.target_dir.mkdir(parents=True, exist_ok=True)
        res = self._run_git(["init"])
        if res.returncode != 0:
            return {"success": False, "error": res.stderr}

        # Create sensible .gitignore if not present
        gitignore_path = self.target_dir / ".gitignore"
        if not gitignore_path.exists():
            with open(gitignore_path, "w", encoding="utf-8") as f:
                f.write("# Temp files and auto-backups\n*.tmp\n*.bak\n.DS_Store\nThumbs.db\n")
            self._run_git(["add", ".gitignore"])
            self._run_git(["commit", "-m", "chore: initialize workflow git repository"])

        return {"success": True, "message": "Repository initialized successfully"}

    def get_status(self) -> Dict[str, Any]:
        if not self.is_repo():
            return {
                "is_repo": False,
                "target_dir": str(self.target_dir),
                "files": self.list_workflow_files(),
                "branch": None,
                "uncommitted": []
            }

        # Get current branch
        branch_res = self._run_git(["branch", "--show-current"])
        branch = branch_res.stdout.strip() if branch_res.returncode == 0 else "main"

        # Get status
        status_res = self._run_git(["status", "--porcelain"])
        uncommitted = []
        if status_res.returncode == 0 and status_res.stdout.strip():
            for line in status_res.stdout.splitlines():
                if line.strip():
                    status_code = line[:2].strip()
                    file_name = line[3:].strip().strip('"')
                    uncommitted.append({"status": status_code, "file": file_name})

        return {
            "is_repo": True,
            "target_dir": str(self.target_dir),
            "files": self.list_workflow_files(),
            "branch": branch,
            "uncommitted": uncommitted
        }

    def list_workflow_files(self) -> List[str]:
        if not self.target_dir.exists():
            return []
        files = []
        for p in self.target_dir.rglob("*.json"):
            # Exclude .git and submodules
            if ".git" not in p.parts:
                rel = p.relative_to(self.target_dir)
                files.append(str(rel).replace("\\", "/"))
        return sorted(files)

    def save_and_commit(self, file_name: str, workflow_json_str: str, message: str) -> Dict[str, Any]:
        if not self.is_repo():
            init_res = self.init_repo()
            if not init_res.get("success"):
                return {"success": False, "error": f"Failed to initialize repository: {init_res.get('error')}"}

        # Ensure filename ends with .json
        if not file_name.endswith(".json"):
            file_name += ".json"

        # Clean filename
        file_path = self.target_dir / file_name
        file_path.parent.mkdir(parents=True, exist_ok=True)

        # Format and save JSON
        try:
            parsed = json.loads(workflow_json_str)
            formatted_json = json.dumps(parsed, indent=2, ensure_ascii=False)
        except Exception:
            formatted_json = workflow_json_str

        with open(file_path, "w", encoding="utf-8") as f:
            f.write(formatted_json)

        # Git add
        add_res = self._run_git(["add", file_name])
        if add_res.returncode != 0:
            return {"success": False, "error": f"Git add failed: {add_res.stderr}"}

        # Commit message
        commit_msg = message.strip() if message.strip() else f"update: {file_name}"
        commit_res = self._run_git(["commit", "-m", commit_msg])

        if commit_res.returncode != 0:
            # Check if working tree clean
            if "nothing to commit" in commit_res.stdout or "nothing to commit" in commit_res.stderr:
                return {"success": True, "message": "No changes to commit (already up to date)", "file": file_name}
            return {"success": False, "error": f"Git commit failed: {commit_res.stderr or commit_res.stdout}"}

        # Get latest commit hash
        hash_res = self._run_git(["rev-parse", "--short", "HEAD"])
        commit_hash = hash_res.stdout.strip() if hash_res.returncode == 0 else ""

        return {
            "success": True,
            "message": "Committed successfully",
            "file": file_name,
            "commit_hash": commit_hash
        }

    def get_history(self, file_name: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
        if not self.is_repo():
            return []

        # %H (full hash) | %h (short hash) | %an (author) | %ad (date) | %s (subject)
        cmd = ["log", f"-n{limit}", '--pretty=format:%H|%h|%an|%ad|%s', "--date=format:%Y-%m-%d %H:%M:%S"]
        if file_name:
            cmd.extend(["--", file_name])

        res = self._run_git(cmd)
        if res.returncode != 0 or not res.stdout.strip():
            return []

        history = []
        for line in res.stdout.splitlines():
            parts = line.strip().split("|", 4)
            if len(parts) == 5:
                history.append({
                    "full_hash": parts[0],
                    "short_hash": parts[1],
                    "author": parts[2],
                    "date": parts[3],
                    "message": parts[4]
                })

        return history

    def get_file_content_at_commit(self, commit_hash: str, file_name: str) -> Optional[str]:
        if not self.is_repo():
            return None
        res = self._run_git(["show", f"{commit_hash}:{file_name}"])
        if res.returncode == 0:
            return res.stdout
        return None
