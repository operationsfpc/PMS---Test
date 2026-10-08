import os
import sys
import zipfile
from pathlib import Path

def create_zip(source_dir: Path, output_zip: Path):
    source_dir = source_dir.resolve()
    output_zip = output_zip.resolve()

    # Ensure parent folder for output zip exists
    output_zip.parent.mkdir(parents=True, exist_ok=True)

    exclude_dirs = {
        "node_modules",
        ".git",
        "dist",
        "build",
        "coverage",
        ".vite",
        ".turbo",
        "__pycache__",
        ".next",
        ".wrangler",
        ".vscode",
        ".idea",
        "playwright-report",
        "test-results",
        "venv",
        ".venv",
        "env",
        ".temp",
        ".gemini",
        ".system_generated",
        ".pnpm-store",
        "scratch",
    }

    exclude_extensions = {
        ".zip",
        ".tar",
        ".gz",
        ".rar",
        ".7z",
        ".pyc",
        ".pyo",
        ".pyd",
        ".log",
        ".tmp",
        ".tsbuildinfo",
    }

    exclude_file_prefixes = (
        "~$",           # MS Office temporary lock files
        ".DS_Store",    # macOS metadata
    )

    exclude_exact_files = {
        "Thumbs.db",
        "desktop.ini",
        "ehthumbs.db",
    }

    print(f"Creating zip from: {source_dir}")
    print(f"Destination:     {output_zip}")

    total_files = 0
    total_bytes = 0

    with zipfile.ZipFile(output_zip, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zipf:
        for root, dirs, files in os.walk(source_dir):
            # Prune directories in-place
            dirs[:] = [
                d for d in dirs 
                if d not in exclude_dirs 
                and not d.startswith(".git")
                and not d.startswith(".venv")
            ]

            for file in files:
                file_path = Path(root) / file

                # Skip self or any other zip archives
                if file_path == output_zip or file_path.suffix.lower() in exclude_extensions:
                    continue

                # Skip Office lock files or system files
                if file.startswith(exclude_file_prefixes) or file in exclude_exact_files:
                    continue

                # Skip sensitive local environment files (preserve .env.example)
                if file.startswith(".env") and file != ".env.example":
                    continue

                # POSIX path relative to source directory (ensures cross-platform zip compatibility)
                rel_path = file_path.relative_to(source_dir).as_posix()

                try:
                    file_size = file_path.stat().st_size
                    zipf.write(file_path, arcname=rel_path)
                    total_files += 1
                    total_bytes += file_size
                except (OSError, PermissionError) as e:
                    print(f"Warning: Skipping {rel_path} due to error: {e}")

    zip_size_mb = output_zip.stat().st_size / (1024 * 1024)
    uncompressed_mb = total_bytes / (1024 * 1024)
    ratio = (1 - (output_zip.stat().st_size / max(total_bytes, 1))) * 100

    print(f"Zip created successfully!")
    print(f"Total files included: {total_files}")
    print(f"Uncompressed size:    {uncompressed_mb:.2f} MB")
    print(f"Compressed zip size:  {zip_size_mb:.2f} MB ({ratio:.1f}% space saved)")

if __name__ == "__main__":
    src = Path(".")
    
    # Check if a custom output was supplied via CLI argument
    if len(sys.argv) > 1:
        custom_out = Path(sys.argv[1])
        create_zip(src, custom_out)
    else:
        # Default behavior: generate in parent directory and a local copy
        out_parent = Path("..") / "fpc-pms-main.zip"
        create_zip(src, out_parent)

        out_local = Path("fpc-pms-updated.zip")
        create_zip(src, out_local)
