#!/usr/bin/env python3
"""
QR SCANNER Release Packager
Usage: python3 scripts/build-release.py [VERSION]
Example: python3 scripts/build-release.py v0.1.0
"""

import os
import sys
import zipfile
from pathlib import Path


def get_project_root() -> Path:
    return Path(__file__).resolve().parent.parent


def should_include(rel_path: str) -> bool:
    """Determine if a file should be included in the release package."""
    # Exclude directories entirely
    excluded_dirs = [
        '.git', '.claude', '.github', 'node_modules', '.vscode', '.idea',
        'tests', 'docs', 'scripts', '__pycache__', 'dist',
    ]
    parts = rel_path.split(os.sep)
    for part in parts:
        if part in excluded_dirs:
            return False

    # Exclude specific files
    excluded_files = [
        '.gitignore', '.gitattributes', '.editorconfig',
        'Plan.md', 'CLAUDE.md', 'RELEASE_TEMPLATE.md',
        'package.json', 'package-lock.json',
        '.env', '.env.local',
    ]
    if parts[-1] in excluded_files:
        return False

    # Exclude OS/IDE files
    if parts[-1] in ('.DS_Store', 'Thumbs.db'):
        return False
    if parts[-1].endswith(('.swp', '.swo', '.log', '.zip', '.crx')):
        return False

    return True


def build_release(version: str) -> Path:
    project_root = get_project_root()
    dist_dir = project_root / 'dist'
    dist_dir.mkdir(exist_ok=True)

    output_file = dist_dir / f'qr-scanner-{version}.zip'

    # Remove old package
    if output_file.exists():
        output_file.unlink()

    included_files = []

    with zipfile.ZipFile(output_file, 'w', zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(project_root):
            # Skip excluded directories during walk
            dirs[:] = [d for d in dirs if d not in {
                '.git', '.claude', '.github', 'node_modules',
                '.vscode', '.idea', '__pycache__', 'dist',
            }]

            for file in files:
                full_path = Path(root) / file
                rel_path = full_path.relative_to(project_root).as_posix()

                if not should_include(rel_path):
                    continue

                zf.write(full_path, rel_path)
                included_files.append(rel_path)

    # Print summary
    print(f"📦 Packaging QR SCANNER {version}...")
    print("")
    print(f"✅ Package created: {output_file.relative_to(project_root)}")
    print(f"📊 Size: {output_file.stat().st_size / 1024:.1f} KB")
    print("")
    print(f"📋 Included files ({len(included_files)}):")
    for f in sorted(included_files):
        print(f"   {f}")
    print("")
    print("🚀 Next steps:")
    print("   1. Create a GitHub Release")
    print(f"   2. Tag: {version}")
    print(f"   3. Upload: {output_file.relative_to(project_root)}")
    print("   4. Add release notes from RELEASE_TEMPLATE.md")

    return output_file


if __name__ == '__main__':
    version = sys.argv[1] if len(sys.argv) > 1 else 'v0.1.0'
    build_release(version)
