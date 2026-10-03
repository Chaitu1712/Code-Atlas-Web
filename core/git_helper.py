import subprocess
from pathlib import Path
from collections import Counter

def get_git_authors(filepath: str, start_line: int, end_line: int):
    """Safely extracts git blame metadata, returning None if git is absent."""
    try:
        path_obj = Path(filepath)
        if not path_obj.exists():
            return None

        cmd = ["git", "blame", "-L", f"{start_line},{end_line}", "--line-porcelain", str(path_obj)]
        startupinfo = None
        if hasattr(subprocess, 'STARTUPINFO'):
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            
        res = subprocess.run(cmd, capture_output=True, text=True, startupinfo=startupinfo, timeout=5)
        if res.returncode != 0: 
            return None
        
        lines = res.stdout.splitlines()
        authors = []
        oldest_time = float('inf')
        original_author = "Unknown"
        current_author = ""
        
        for line in lines:
            if line.startswith("author "):
                current_author = line[7:]
                authors.append(current_author)
            elif line.startswith("author-time "):
                time = int(line[12:])
                if time < oldest_time:
                    oldest_time = time
                    original_author = current_author

        heavy_contributor = Counter(authors).most_common(1)[0][0] if authors else "Unknown"
        return {
            "original": original_author,
            "heavy": heavy_contributor,
        }
    except Exception:
        return None