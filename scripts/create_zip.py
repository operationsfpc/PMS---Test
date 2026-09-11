import os
import zipfile
from pathlib import Path

def create_zip(source_dir: Path, output_zip: Path):
    source_dir = source_dir.resolve()
    output_zip = output_zip.resolve()

    exclude_dirs = {
        "node_modules",
        ".git",
        "dist",
        "coverage",
        ".vite",
        ".turbo",
        "__pycache__",
        ".next",
    }

    exclude_extensions = {".zip", ".pyc"}

    print(f"Creating zip from: {source_dir}")
    print(f"Destination: {output_zip}")

    total_files = 0
    total_bytes = 0

    with zipfile.ZipFile(output_zip, "w", zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(source_dir):
            # Modify dirs in-place to prevent os.walk from descending into excluded directories
            dirs[:] = [d for d in dirs if d not in exclude_dirs and not d.startswith(".git")]

            for file in files:
                file_path = Path(root) / file
                
                # Exclude unwanted extensions or self
                if file_path.suffix.lower() in exclude_extensions or file_path == output_zip:
                    continue
                if file.startswith(".DS_Store") or file == "Thumbs.db":
                    continue

                rel_path = file_path.relative_to(source_dir)
                zipf.write(file_path, arcname=str(rel_path))
                total_files += 1
                total_bytes += file_path.stat().st_size

    zip_size_mb = output_zip.stat().st_size / (1024 * 1024)
    print(f"Zip created successfully!")
    print(f"Total files included: {total_files}")
    print(f"Uncompressed size: {total_bytes / (1024 * 1024):.2f} MB")
    print(f"Compressed zip size: {zip_size_mb:.2f} MB")

if __name__ == "__main__":
    src = Path(".")
    # Write to parent directory and project root
    out1 = Path("..") / "fpc-pms-main.zip"
    create_zip(src, out1)

    # Also make a copy in current directory for easy access
    out2 = Path("fpc-pms-updated.zip")
    create_zip(src, out2)
