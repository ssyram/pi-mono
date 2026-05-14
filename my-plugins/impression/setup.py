#!/usr/bin/env python3
"""
Impression System — Setup Script

Cross-platform installer that:
  1. Checks for / installs pi (the coding agent)
  2. Interactively guides API key configuration (skippable)
  3. Installs the impression extension into pi (skippable)

Supports macOS, Linux, and Windows.
"""
from __future__ import annotations

import os
import platform
import re
import shutil
import subprocess
import sys
from pathlib import Path


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def heading(text: str) -> None:
    print(f"\n{'=' * 60}")
    print(f"  {text}")
    print(f"{'=' * 60}\n")


def info(text: str) -> None:
    print(f"  [*] {text}")


def warn(text: str) -> None:
    print(f"  [!] {text}")


def error(text: str) -> None:
    print(f"  [ERROR] {text}", file=sys.stderr)


def ask_yes_no(prompt: str, default: bool = True) -> bool:
    suffix = " [Y/n] " if default else " [y/N] "
    while True:
        try:
            answer = input(f"  {prompt}{suffix}").strip().lower()
        except EOFError:
            return default
        if answer == "":
            return default
        if answer in ("y", "yes"):
            return True
        if answer in ("n", "no"):
            return False


def ask_input(prompt: str, default: str = "") -> str:
    display = f"  {prompt}"
    if default:
        display += f" [{default}]"
    display += ": "
    try:
        answer = input(display).strip()
    except EOFError:
        return default
    return answer if answer else default


def which(cmd: str) -> str | None:
    return shutil.which(cmd)


def run(cmd: list[str], check: bool = True, capture: bool = False) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=check, capture_output=capture, text=True)


def impression_dir() -> Path:
    """Return the directory where this setup.py lives (== impression root)."""
    return Path(__file__).resolve().parent


# ---------------------------------------------------------------------------
# Step 1: Ensure pi is installed
# ---------------------------------------------------------------------------

def ensure_pi() -> bool:
    heading("Step 1: Check pi installation")

    if which("pi"):
        try:
            result = run(["pi", "--version"], capture=True, check=False)
            if result.returncode == 0:
                version = result.stdout.strip() or result.stderr.strip()
                info(f"pi is already installed: {version}")
            else:
                info("pi binary found but could not determine version.")
            return True
        except Exception:
            info("pi binary found but could not determine version.")
            return True

    warn("pi is not installed.")
    if not ask_yes_no("Install pi via npm now?"):
        warn("Skipping pi installation. You can install it manually:")
        info("  npm install -g @mariozechner/pi-coding-agent")
        return False

    # Check for npm
    if not which("npm"):
        error("npm is not installed. Please install Node.js (https://nodejs.org) first.")
        return False

    info("Installing pi globally via npm...")
    try:
        run(["npm", "install", "-g", "@mariozechner/pi-coding-agent"])
        info("pi installed successfully.")
        return True
    except subprocess.CalledProcessError as e:
        error(f"npm install failed (exit code {e.returncode}).")
        warn("Try running manually: npm install -g @mariozechner/pi-coding-agent")
        if platform.system() != "Windows":
            warn("If you get a permission error, try: sudo npm install -g @mariozechner/pi-coding-agent")
            warn("Or use nvm to manage Node.js installations without sudo.")
        return False


# ---------------------------------------------------------------------------
# Step 2: Configure API provider
# ---------------------------------------------------------------------------

PROVIDERS = [
    ("ANTHROPIC_API_KEY",   "Anthropic (Claude)"),
    ("OPENAI_API_KEY",      "OpenAI (GPT)"),
    ("GOOGLE_API_KEY",      "Google (Gemini)"),
    ("OPENROUTER_API_KEY",  "OpenRouter"),
]


def get_shell_profile() -> Path:
    """Best-effort guess for the user's shell profile."""
    system = platform.system()
    home = Path.home()
    if system == "Windows":
        # PowerShell profile — check several candidate locations
        user_profile = Path(os.environ.get("USERPROFILE", str(home)))
        candidates = [
            user_profile / "Documents" / "PowerShell" / "Microsoft.PowerShell_profile.ps1",
            user_profile / "Documents" / "WindowsPowerShell" / "Microsoft.PowerShell_profile.ps1",
            home / "Documents" / "PowerShell" / "Microsoft.PowerShell_profile.ps1",
        ]
        for ps_profile in candidates:
            if ps_profile.parent.exists():
                return ps_profile
        return home / ".bashrc"  # Git Bash / WSL fallback
    shell = os.environ.get("SHELL", "/bin/bash")
    if "zsh" in shell:
        return home / ".zshrc"
    if "fish" in shell:
        return home / ".config" / "fish" / "config.fish"
    return home / ".bashrc"


def configure_api_keys() -> None:
    heading("Step 2: Configure LLM API keys")

    info("pi needs at least one LLM provider API key to work.")
    info("You can skip this step and set environment variables manually later.\n")

    if not ask_yes_no("Configure API keys now?"):
        warn("Skipping API key configuration.")
        info("Set one of these environment variables before running pi:")
        for env_var, label in PROVIDERS:
            info(f"  export {env_var}=<your-key>    # {label}")
        return

    print()
    for i, (env_var, label) in enumerate(PROVIDERS, 1):
        existing = os.environ.get(env_var, "")
        status = " (already set)" if existing else ""
        print(f"    {i}. {label}{status}")
    print(f"    {len(PROVIDERS) + 1}. Other / custom provider URL")
    print()

    chosen_env_var = None
    chosen_value = None
    custom_url = None

    choice = ask_input("Select a provider (number)", "1")
    try:
        idx = int(choice)
    except ValueError:
        warn("Invalid input, defaulting to provider 1.")
        idx = 1

    if 1 <= idx <= len(PROVIDERS):
        env_var, label = PROVIDERS[idx - 1]
        existing = os.environ.get(env_var, "")
        if existing:
            info(f"{env_var} is already set. Skipping.")
            return
        value = ask_input(f"Enter your {label} API key")
        if not value:
            warn("No key entered. Skipping.")
            return
        chosen_env_var = env_var
        chosen_value = value
    elif idx == len(PROVIDERS) + 1:
        custom_url = ask_input("Enter your provider base URL (e.g. http://localhost:11434)")
        env_var_name = ask_input("Environment variable name for the API key (leave empty if none)")
        if env_var_name:
            if not re.match(r'^[A-Za-z_][A-Za-z0-9_]*$', env_var_name):
                warn("Invalid environment variable name (must match [A-Za-z_][A-Za-z0-9_]*). Skipping.")
                return
            value = ask_input(f"Enter the API key for {env_var_name}")
            if value:
                chosen_env_var = env_var_name
                chosen_value = value
    else:
        warn("Invalid choice. Skipping.")
        return

    # Persist to shell profile
    if chosen_env_var and chosen_value:
        profile = get_shell_profile()
        if ask_yes_no(f"Append export to {profile}?"):
            system = platform.system()
            # Escape value for the target shell to prevent shell injection
            if system == "Windows" and "PowerShell" in str(profile):
                # PowerShell: single-quote the value, double internal single quotes
                escaped = chosen_value.replace("'", "''")
                line = f"\n$env:{chosen_env_var} = '{escaped}'\n"
            elif "fish" in str(profile):
                # fish: use single quotes, escape backslashes and single quotes
                escaped = chosen_value.replace("\\", "\\\\").replace("'", "\\'")
                line = f"\nset -gx {chosen_env_var} '{escaped}'\n"
            else:
                # bash/zsh: single-quote the value (safest), escape internal single quotes
                escaped = chosen_value.replace("'", "'\\''")
                line = f"\nexport {chosen_env_var}='{escaped}'\n"

            try:
                with open(profile, "a", encoding="utf-8") as f:
                    f.write(line)
            except OSError as e:
                error(f"Could not write to {profile}: {e}")
                warn("Please check the file manually for any partial writes.")
                info("You can add the export manually to your shell profile.")
                os.environ[chosen_env_var] = chosen_value
                return
            info(f"Appended to {profile}")
            info(f"Note: Ensure {profile} has appropriate permissions (e.g. 600) to protect your API key.")
            info(f"Run `source {profile}` or open a new terminal to activate.")
            # Also set for current process so step 3 can use pi
            os.environ[chosen_env_var] = chosen_value
        else:
            info("You can add it manually:")
            info(f"  export {chosen_env_var}=<your-key>")
            os.environ[chosen_env_var] = chosen_value

    if custom_url:
        info(f"\nTo use a custom provider, run pi with:")
        info(f"  pi --provider openai-compatible --api-url {custom_url}")


# ---------------------------------------------------------------------------
# Step 3: Install the impression extension
# ---------------------------------------------------------------------------

def install_extension() -> None:
    heading("Step 3: Install impression extension")

    ext_dir = impression_dir()
    index_file = ext_dir / "index.ts"
    if not index_file.exists():
        error(f"Cannot find {index_file}. Make sure setup.py is in the impression directory.")
        return

    info(f"Extension directory: {ext_dir}")

    if not which("pi"):
        warn("pi is not installed. Cannot register extension automatically.")
        info("After installing pi, run:")
        info(f"  pi install {ext_dir}")
        return

    if not ask_yes_no("Install impression extension into pi now?"):
        warn("Skipping extension installation.")
        info("You can install it later with:")
        info(f"  pi install {ext_dir}")
        return

    info(f"Running: pi install {ext_dir}")
    try:
        run(["pi", "install", str(ext_dir)])
        info("Extension installed successfully.")
    except subprocess.CalledProcessError:
        warn("pi install failed. Trying manual symlink as fallback...")
        manual_symlink(ext_dir)


def manual_symlink(ext_dir: Path) -> None:
    """Fallback: symlink into ~/.pi/extensions/."""
    system = platform.system()
    home = Path.home()
    extensions_dir = home / ".pi" / "extensions"
    target = extensions_dir / "impression"

    if target.exists() or target.is_symlink():
        info(f"Link already exists at {target}")
        return

    extensions_dir.mkdir(parents=True, exist_ok=True)

    try:
        if system == "Windows":
            # Windows requires special handling for symlinks
            # Use directory junction as fallback (no admin needed)
            # Use shell=True to handle paths with spaces correctly
            subprocess.run(
                f'cmd /c mklink /J "{target}" "{ext_dir}"',
                shell=True, check=True,
            )
        else:
            target.symlink_to(ext_dir)
        info(f"Symlinked {target} -> {ext_dir}")
    except (subprocess.CalledProcessError, OSError) as e:
        error(f"Could not create symlink: {e}")
        info("Create it manually:")
        if system == "Windows":
            info(f'  mklink /J "{target}" "{ext_dir}"')
        else:
            info(f"  ln -s {ext_dir} {target}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    heading("Impression System — Setup")
    info("This script will help you set up pi and the Impression extension.")
    info(f"Platform: {platform.system()} {platform.machine()}")
    info(f"Python: {sys.version.split()[0]}")
    print()

    pi_ok = ensure_pi()
    configure_api_keys()

    if pi_ok:
        install_extension()
    else:
        heading("Step 3: Install impression extension (skipped)")
        warn("Skipping extension installation because pi is not available.")
        info("After installing pi, run this setup script again or install manually:")
        info(f"  pi install {impression_dir()}")

    heading("Setup Complete")
    if pi_ok:
        info("Run `pi` to start a coding session with impression-powered context compression.")
    else:
        warn("pi was not installed. Please install it before using impression.")
    info("Configuration: create .pi/impression.json in your project root (optional).")
    info("Documentation: see README.md in this directory.")
    print()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n  [*] Setup interrupted by user. Exiting.")
        sys.exit(130)
    except EOFError:
        print("\n\n  [*] No input available. Exiting.")
        sys.exit(1)
