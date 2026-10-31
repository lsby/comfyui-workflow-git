# ComfyUI Workflow Git

A lightweight, native Git version control extension for ComfyUI workflows.

Unlike heavy environment managers that try to isolate your entire ComfyUI setup and store files in global home directories, **ComfyUI Workflow Git** focuses purely on what matters: **tracking your workflow versions in your project's local workspace with real Git commits.**

## Features

- **Native Git Integration**: Pure Git operations via standard system Git (`git add`, `git commit`, `git log`, `git show`).
- **Relative Path Support**: Keep your workflows folder right inside your project directory (e.g. `../../工作流`). Moving or copying your portable ComfyUI setup to another drive or machine will never break paths.
- **One-Click Commit**: Save the current workflow from canvas and create a Git commit with a descriptive message in seconds.
- **Visual Version History**: Inspect all past commits, dates, hashes, and commit messages.
- **One-Click Restore**: Instantly load any past commit's workflow directly back onto your ComfyUI canvas.
- **Zero Heavy Dependencies**: No custom virtual environments, no Docker containers, no background sync daemon. 100% lightweight and clean.

## Installation

1. Copy or clone this folder into your ComfyUI `custom_nodes/` directory:
   ```bash
   cd ComfyUI/custom_nodes
   git clone https://github.com/lsby/comfyui-workflow-git.git
   ```
2. Restart ComfyUI.

## Usage

1. Open ComfyUI in your browser.
2. Click the blue **Git Commit** button on the menu bar, or press **`Alt + G`**.
3. In the modal:
   - **Commit Tab**: Enter your workflow file name (e.g., `main-workflow.json`), type your commit message, and click **Commit Workflow**.
   - **History Tab**: View past commits and click **Restore** to reload that version to canvas.
   - **Settings Tab**: Configure your workflows directory path (supports relative paths).

## License

MIT License.
