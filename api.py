import os
import gc
import time
import shutil
import zipfile
import asyncio
import tempfile
import traceback
from pathlib import Path
from typing import List, Optional

import httpx
import uvicorn
from fastapi import (
    FastAPI, Query, Header, HTTPException, WebSocket, 
    WebSocketDisconnect, BackgroundTasks, Depends, UploadFile, File, Form, Request
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

# Core Internal Modules
from core.analyzer import GraphAnalyzer
from core.embeddings import EmbeddingService
from core.parser import CodeParser
from core.db import Database, get_raw_connection
from core.ignore import GitIgnoreChecker
from core.api_linker import APILinker
from core.config import get_config, save_config, is_setup_complete
from core.llm import CodeAtlasAI
from core.strategies.path_normalizer import normalize_path
from core.git_helper import get_git_authors
from core.models import ChatRequest, LayoutUpdate, GithubRequest

app = FastAPI(title="Code Atlas Web API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_DIR = Path("data").resolve()
DATA_DIR.mkdir(exist_ok=True)

MAIN_LOOP: Optional[asyncio.AbstractEventLoop] = None

@app.on_event("startup")
async def startup_event():
    global MAIN_LOOP
    MAIN_LOOP = asyncio.get_running_loop()
    print("🚀 [SERVER] ASGI Event Loop captured for non-blocking notifications.")

@app.middleware("http")
async def log_requests(request: Request, call_next):
    start_time = time.perf_counter()
    response = await call_next(request)
    duration_ms = (time.perf_counter() - start_time) * 1000

    color = "\033[33m" if duration_ms > 250 else "\033[32m"
    reset = "\033[0m"
    
    if not request.url.path.startswith("/ws/"):
        print(f"{color}⚡ [{response.status_code}] {request.method} {request.url.path} ({duration_ms:.1f}ms){reset}")
        
    return response

def get_user_projects_dir(user_id: str) -> Path:
    safe_user = "".join(c for c in user_id if c.isalnum() or c in "-_") or "anonymous"
    d = DATA_DIR / "users" / safe_user / "projects"
    d.mkdir(parents=True, exist_ok=True)
    return d

def get_client_id(x_user_id: Optional[str] = Header(None, alias="X-User-ID")) -> str:
    if not x_user_id:
        return "anonymous_device"
    return "".join(c for c in x_user_id if c.isalnum() or c in "-_")

def get_client_gemini_key(x_gemini_key: Optional[str] = Header(None, alias="X-Gemini-Key")) -> Optional[str]:
    return x_gemini_key


# --- WEBSOCKET MANAGER ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, user_id: str):
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        self.active_connections[user_id].append(websocket)

    def disconnect(self, websocket: WebSocket, user_id: str):
        if user_id in self.active_connections and websocket in self.active_connections[user_id]:
            self.active_connections[user_id].remove(websocket)

    async def send_personal_message(self, message: dict, user_id: str):
        if user_id in self.active_connections:
            for connection in self.active_connections[user_id]:
                try:
                    await connection.send_json(message)
                except Exception:
                    pass

ws_manager = ConnectionManager()

def dispatch_progress(user_id: str, status: str, message: str, percent: int):
    """Dispatches progress to WebSockets without blocking background worker threads."""
    global MAIN_LOOP
    payload = {"status": status, "message": message, "percent": percent}
    if MAIN_LOOP and MAIN_LOOP.is_running():
        asyncio.run_coroutine_threadsafe(
            ws_manager.send_personal_message(payload, user_id),
            MAIN_LOOP
        )

@app.websocket("/ws/progress")
async def websocket_endpoint(websocket: WebSocket, client_id: str = Query(...)):
    safe_id = "".join(c for c in client_id if c.isalnum() or c in "-_")
    await ws_manager.connect(websocket, safe_id)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket, safe_id)


# --- CONFIGURATION ENDPOINTS ---
@app.get("/api/config")
def read_config(user_id: str = Depends(get_client_id)):
    return {
        "config": get_config(user_id), 
        "is_setup_complete": is_setup_complete(user_id)
    }

@app.post("/api/config")
def update_config(new_config: dict, user_id: str = Depends(get_client_id)):
    current = get_config(user_id)
    current.update(new_config)
    save_config(user_id, current)
    return {"status": "success"}


# --- FAST PIPELINE EXECUTION ---
def execute_pipeline(source_dir: Path, project_dir: Path, user_id: str, gemini_key: Optional[str]):
    pipeline_start = time.perf_counter()
    project_name = project_dir.name
    project_id = f"{user_id}:{project_name}"
    project_dir.mkdir(parents=True, exist_ok=True)
    db_path = project_dir / "atlas.db"

    # Persist source files in project_dir so git blame and code inspection work
    source_storage = project_dir / "source"
    if source_storage.exists():
        shutil.rmtree(source_storage)
    try:
        shutil.copytree(source_dir, source_storage)
    except Exception:
        pass

    print(f"\n=======================================================")
    print(f"🚀 [PIPELINE] Project: '{project_name}' | User: {user_id}")
    print(f"=======================================================")

    # 1. Purge old project data
    t0 = time.perf_counter()
    db = Database(str(db_path), project_id=project_id)
    db.clear_project_data()
    print(f"🧹 [1/5] Database Cleaned in {(time.perf_counter() - t0)*1000:.1f}ms")

    # 2. Discover Files from source_storage
    t0 = time.perf_counter()
    parser = CodeParser()
    ignore_checker = GitIgnoreChecker(str(source_storage))

    valid_files = []
    valid_extensions = {'.py', '.js', '.jsx', '.ts', '.tsx'}

    for root, dirs, files in os.walk(source_storage):
        root_path = Path(root)
        try:
            rel_root = str(root_path.relative_to(source_storage))
        except ValueError:
            rel_root = ""

        for i in range(len(dirs) - 1, -1, -1):
            if ignore_checker.is_ignored(dirs[i], os.path.join(rel_root, dirs[i])):
                del dirs[i]

        for f in files:
            file_path = root_path / f
            if file_path.suffix in valid_extensions and not ignore_checker.is_ignored(f, os.path.join(rel_root, f)):
                valid_files.append(file_path)

    total = len(valid_files)
    print(f"🔍 [2/5] Discovery Complete: Found {total} files in {(time.perf_counter() - t0)*1000:.1f}ms")

    if total == 0:
        dispatch_progress(user_id, "Error", "No supported source files found.", 0)
        db.close()
        return

    # 3. AST Parsing with Bulk Inserts
    t0 = time.perf_counter()
    BATCH_SIZE = 50
    parsed_batch = []
    last_reported_percent = 0

    try:
        for i, file in enumerate(valid_files, 1):
            try:
                parsed_module = parser.parse_file(str(file))
                rel_path = file.relative_to(source_storage)
                parsed_module.filepath = str(rel_path).replace("\\", "/")
                parsed_batch.append(parsed_module)
            except Exception:
                pass

            percent = int(10 + (i / total) * 45)
            if i % 10 == 0 or i == total or (percent - last_reported_percent >= 3):
                last_reported_percent = percent
                dispatch_progress(user_id, "Parsing AST...", f"Parsed {i} of {total} files...", percent)

            if len(parsed_batch) >= BATCH_SIZE:
                t_b = time.perf_counter()
                db.save_modules_batch(parsed_batch)
                print(f"   💾 Multi-row commit: {len(parsed_batch)} files in {(time.perf_counter() - t_b)*1000:.1f}ms")
                parsed_batch.clear()

        if parsed_batch:
            t_b = time.perf_counter()
            db.save_modules_batch(parsed_batch)
            print(f"   💾 Final multi-row commit: {len(parsed_batch)} files in {(time.perf_counter() - t_b)*1000:.1f}ms")
            parsed_batch.clear()

    finally:
        db.close()

    parse_time = time.perf_counter() - t0
    speed = total / parse_time if parse_time > 0 else 0
    print(f"🌳 [3/5] AST & DB Complete: {total} files in {parse_time:.2f}s ({speed:.1f} files/sec)")

    # 4. Cross-Language API Linkage
    t0 = time.perf_counter()
    dispatch_progress(user_id, "Linking APIs...", "Connecting cross-language endpoints...", 65)
    linker = APILinker(str(db_path), project_id=project_id)
    linker.run_linkage()
    print(f"🔗 [4/5] API Linkage Complete in {(time.perf_counter() - t0)*1000:.1f}ms")

    # 5. Gemini Vector Embeddings
    effective_key = gemini_key or get_config(user_id).get("gemini_api_key")
    if effective_key:
        t0 = time.perf_counter()
        dispatch_progress(user_id, "Vectorizing...", "Generating Gemini embeddings...", 80)
        embedder = EmbeddingService(
            str(db_path), 
            project_id=project_id, 
            api_key=effective_key,
            user_id=user_id,
            progress_callback=lambda msg, pct: dispatch_progress(user_id, "Vectorizing...", msg, pct)
        )
        embedder.generate_embeddings()
        print(f"🧠 [5/5] Vector Embeddings Complete in {(time.perf_counter() - t0):.2f}s")
    else:
        print("⏩ [5/5] Embeddings Skipped: No Gemini key provided.")
        dispatch_progress(user_id, "Finalizing...", "Ready (No Gemini Key)...", 85)

    total_time = time.perf_counter() - pipeline_start
    print(f"=======================================================")
    print(f"✨ [PIPELINE SUCCESS] '{project_name}' ready in {total_time:.2f}s total.")
    print(f"=======================================================\n")

    dispatch_progress(user_id, "Complete!", "Code Atlas is ready.", 100)

# --- INGESTION: GITHUB ARCHIVE ---
import subprocess

@app.post("/api/projects/github")
async def add_github_project(
    req: GithubRequest, 
    background_tasks: BackgroundTasks, 
    user_id: str = Depends(get_client_id),
    gemini_key: Optional[str] = Depends(get_client_gemini_key)
):
    clean_url = req.github_url.strip().rstrip('/')
    repo_name = req.project_name or clean_url.split('/')[-1].replace('.git', '')
    
    def process_github(uid: str, key: Optional[str]):
        user_projects_dir = get_user_projects_dir(uid)
        project_dir = user_projects_dir / repo_name
        
        dispatch_progress(uid, "Downloading...", f"Cloning {repo_name}...", 5)
        temp_dir = Path(tempfile.mkdtemp(prefix=f"{uid}_{repo_name}_"))

        download_success = False
        t_dl = time.perf_counter()

        # 1. Try shallow git clone first (preserves Git authors/blame)
        try:
            subprocess.run(
                ["git", "clone", "--depth", "1", clean_url, str(temp_dir)],
                check=True, timeout=45, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
            download_success = True
            print(f"📦 Git cloned '{repo_name}' with commit history in {(time.perf_counter() - t_dl):.2f}s")
        except Exception as e:
            print(f"⚠️ Git clone failed ({e}), falling back to zip snapshot...")

        # 2. Fallback to zip download if Git CLI fails
        if not download_success:
            parts = clean_url.replace("https://github.com/", "").split("/")
            if len(parts) >= 2:
                owner, repo = parts[0], parts[1].replace(".git", "")
                for branch in ["main", "master"]:
                    zip_url = f"https://codeload.github.com/{owner}/{repo}/zip/refs/heads/{branch}"
                    try:
                        with httpx.Client(follow_redirects=True, timeout=60.0) as client:
                            resp = client.get(zip_url)
                            if resp.status_code == 200:
                                zip_path = temp_dir / "repo.zip"
                                zip_path.write_bytes(resp.content)
                                with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                                    zip_ref.extractall(temp_dir)
                                os.remove(zip_path)
                                download_success = True
                                break
                    except Exception:
                        continue

        if not download_success:
            dispatch_progress(uid, "Error", "Failed to download repository.", 0)
            shutil.rmtree(temp_dir, ignore_errors=True)
            return

        extracted_roots = [d for d in temp_dir.iterdir() if d.is_dir() and d.name != ".git"]
        target_src = extracted_roots[0] if (len(extracted_roots) == 1 and not (temp_dir / ".git").exists()) else temp_dir

        try:
            execute_pipeline(target_src, project_dir, uid, key)
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)
            gc.collect()

    background_tasks.add_task(process_github, user_id, gemini_key)
    return {"status": "started", "project_name": repo_name}

# --- INGESTION: ZIP UPLOAD ---
@app.post("/api/projects/upload-zip")
async def upload_zip_project(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    project_name: str = Form(...),
    user_id: str = Depends(get_client_id),
    gemini_key: Optional[str] = Depends(get_client_gemini_key)
):
    clean_name = "".join(c for c in project_name if c.isalnum() or c in "-_") or "uploaded_project"

    def process_zip(uid: str, key: Optional[str]):
        user_projects_dir = get_user_projects_dir(uid)
        project_dir = user_projects_dir / clean_name
        temp_dir = Path(tempfile.mkdtemp(prefix=f"{uid}_{clean_name}_"))
        zip_path = temp_dir / "upload.zip"

        dispatch_progress(uid, "Unpacking...", "Extracting uploaded archive...", 5)

        try:
            t_up = time.perf_counter()
            with zip_path.open("wb") as buffer:
                shutil.copyfileobj(file.file, buffer)

            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                zip_ref.extractall(temp_dir)
            os.remove(zip_path)
            print(f"📦 Unpacked ZIP '{file.filename}' in {(time.perf_counter() - t_up)*1000:.1f}ms")

            extracted_roots = [d for d in temp_dir.iterdir() if d.is_dir()]
            target_src = extracted_roots[0] if (len(extracted_roots) == 1 and not any(temp_dir.glob("*.py"))) else temp_dir

            execute_pipeline(target_src, project_dir, uid, key)
        except Exception as e:
            traceback.print_exc()
            dispatch_progress(uid, "Error", f"Unpack failed: {str(e)}", 0)
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)
            gc.collect()

    background_tasks.add_task(process_zip, user_id, gemini_key)
    return {"status": "started", "project_name": clean_name}


# --- PROJECTS LIST & DELETE ---
@app.get("/api/projects")
def list_projects(user_id: str = Depends(get_client_id)):
    user_projects_dir = get_user_projects_dir(user_id)
    local_projects = [d.name for d in user_projects_dir.iterdir() if d.is_dir()]
    
    db_path = user_projects_dir / "check" / "atlas.db"
    conn = get_raw_connection(str(db_path))
    cursor = conn.cursor()
    cursor.execute("SELECT DISTINCT project_id FROM files WHERE project_id LIKE ?", (f"{user_id}:%",))
    cloud_projects = [row[0].split(":", 1)[1] for row in cursor.fetchall() if ":" in row[0]]
    conn.close()

    return sorted(list(set(local_projects + cloud_projects)))

@app.delete("/api/projects/{project_name}")
def delete_project(project_name: str, user_id: str = Depends(get_client_id)):
    user_projects_dir = get_user_projects_dir(user_id)
    project_dir = user_projects_dir / project_name
    project_id = f"{user_id}:{project_name}"

    db_path = project_dir / "atlas.db"
    db = Database(str(db_path), project_id=project_id)
    db.clear_project_data()
    db.close()

    if project_dir.exists() and project_dir.is_dir():
        shutil.rmtree(project_dir, ignore_errors=True)
            
    print(f"🗑️ Deleted project '{project_name}' for user {user_id}")
    return {"status": "success"}


# --- GRAPH & LAYOUT ---
@app.get("/api/graph/{project_name}")
def get_graph(project_name: str, user_id: str = Depends(get_client_id)):
    db_path = get_user_projects_dir(user_id) / project_name / "atlas.db"
    project_id = f"{user_id}:{project_name}"

    analyzer = GraphAnalyzer(str(db_path), project_id=project_id)
    try:
        analyzer.build_module_graph()
        return {
            "graph": analyzer.export_json(),
            "cycles": [c for c in analyzer.get_cyclic_dependencies() if len(c) > 1]
        }
    finally:
        analyzer.conn.close()

@app.post("/api/graph/{project_name}/layout")
def save_layout(project_name: str, updates: List[LayoutUpdate], user_id: str = Depends(get_client_id)):
    db_path = get_user_projects_dir(user_id) / project_name / "atlas.db"
    project_id = f"{user_id}:{project_name}"

    conn = get_raw_connection(str(db_path))
    cursor = conn.cursor()
    for u in updates:
        if u.fx is None or u.fy is None:
            cursor.execute("DELETE FROM layout WHERE project_id = ? AND node_id = ?", (project_id, u.node_id))
        else:
            cursor.execute("""
                INSERT OR REPLACE INTO layout (project_id, node_id, fx, fy) 
                VALUES (?, ?, ?, ?)
            """, (project_id, u.node_id, u.fx, u.fy))
    conn.commit()
    conn.close()
    return {"status": "success"}


# --- SEMANTIC SEARCH ---
@app.get("/api/search/{project_name}")
def search_codebase(
    project_name: str, 
    q: str = Query(...), 
    user_id: str = Depends(get_client_id),
    gemini_key: Optional[str] = Depends(get_client_gemini_key)
):
    db_path = get_user_projects_dir(user_id) / project_name / "atlas.db"
    project_id = f"{user_id}:{project_name}"

    effective_key = gemini_key or get_config(user_id).get("gemini_api_key")
    embedder = EmbeddingService(str(db_path), project_id=project_id, api_key=effective_key)
    results = embedder.search(q, top_k=5)
    return {"query": q, "results": results}


# --- FAST CODE PANEL DETAILS ---
@app.get("/api/node/{project_name}/{node_id:path}")
def get_node_details(project_name: str, node_id: str, user_id: str = Depends(get_client_id)):
    user_projects_dir = get_user_projects_dir(user_id)
    project_dir = user_projects_dir / project_name
    db_path = project_dir / "atlas.db"
    project_id = f"{user_id}:{project_name}"
    node_name = node_id.split('.')[-1]

    conn = get_raw_connection(str(db_path))
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT n.name, n.node_type, n.parent_name, n.start_line, n.end_line, n.code_snippet, f.filepath
            FROM nodes n JOIN files f ON n.file_id = f.id 
            WHERE n.project_id = ? AND n.name = ?
        """, (project_id, node_name))
        
        rows = cursor.fetchall()
        for row in rows:
            name, node_type, parent_name, start_line, end_line, snippet, filepath = row
            mod_name = normalize_path(filepath)
            expected_id = f"{mod_name}.{parent_name}.{name}" if parent_name else f"{mod_name}.{name}"
            
            if expected_id == node_id or len(rows) == 1:
                scoped_caller = f"{parent_name}.{name}" if parent_name else name

                # 1. Fetch Callees (What does this function/method call?)
                cursor.execute("""
                    SELECT DISTINCT callee 
                    FROM calls 
                    WHERE project_id = ? AND (caller = ? OR caller = ? OR caller LIKE ?)
                """, (project_id, name, scoped_caller, f"%.{name}"))
                callees = [r[0] for r in cursor.fetchall() if r[0] and r[0] != "API"]

                # 2. Fetch Callers (Who calls this function/class?)
                # If this is __init__, callers of the parent class are also callers of __init__!
                callee_targets = [name]
                if parent_name:
                    callee_targets.append(parent_name)
                    callee_targets.append(scoped_caller)

                placeholders = ",".join(["?"] * len(callee_targets))
                cursor.execute(f"""
                    SELECT DISTINCT caller 
                    FROM calls 
                    WHERE project_id = ? AND callee IN ({placeholders})
                """, [project_id] + callee_targets)
                callers = [r[0] for r in cursor.fetchall() if r[0] and r[0] not in ["global", name, scoped_caller]]

                # 3. Read Git Authors from persistent source directory
                git_data = None
                source_storage = project_dir / "source"
                full_file = source_storage / filepath
                if full_file.exists():
                    git_data = get_git_authors(str(full_file), start_line, end_line)

                return {
                    "id": node_id, 
                    "name": name, 
                    "type": node_type, 
                    "filepath": filepath, 
                    "line_start": start_line, 
                    "line_end": end_line, 
                    "code": snippet,
                    "git": git_data,
                    "callers": sorted(list(set(callers))),
                    "callees": sorted(list(set(callees)))
                }
    finally:
        conn.close()
        
    return {"id": node_id, "type": "module/package", "message": "No code snippet available."}
# --- STREAMING CHAT ---
@app.post("/api/chat/{project_name}")
async def chat_endpoint(
    project_name: str, 
    req: ChatRequest, 
    user_id: str = Depends(get_client_id),
    gemini_key: Optional[str] = Depends(get_client_gemini_key)
):
    db_path = str((get_user_projects_dir(user_id) / project_name / "atlas.db").resolve())
    project_id = f"{user_id}:{project_name}"
    
    ai = CodeAtlasAI(db_path, user_id=user_id, project_id=project_id, api_key=gemini_key)
    return StreamingResponse(
        ai.stream_chat(req.node_id, req.message, req.selected_model), 
        media_type="text/plain"
    )

@app.get("/health")
def health_check():
    return {"status": "healthy"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)