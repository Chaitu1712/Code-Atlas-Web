import os
import gc
import shutil
import zipfile
import asyncio
import tempfile
from pathlib import Path
from typing import List, Optional

import httpx
import uvicorn
from fastapi import (
    FastAPI, Query, Header, HTTPException, WebSocket, 
    WebSocketDisconnect, BackgroundTasks, Depends, UploadFile, File, Form
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from core.analyzer import GraphAnalyzer
from core.embeddings import EmbeddingService
from core.parser import CodeParser
from core.db import Database
from core.ignore import GitIgnoreChecker
from core.api_linker import APILinker
from core.config import get_config, save_config, is_setup_complete
from core.llm import CodeAtlasAI
from core.strategies.path_normalizer import normalize_path
from core.git_helper import get_git_authors
from core.models import ChatRequest, LayoutUpdate, GithubRequest
from dotenv import load_dotenv

load_dotenv()
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

embedder_cache = {}
ai_cache = {}

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

@app.websocket("/ws/progress")
async def websocket_endpoint(websocket: WebSocket, client_id: str = Query(...)):
    safe_id = "".join(c for c in client_id if c.isalnum() or c in "-_")
    await ws_manager.connect(websocket, safe_id)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket, safe_id)


# --- CONFIGURATION (PER FINGERPRINT) ---
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


# --- PARSING CORE PIPELINE ---
def execute_pipeline(source_dir: Path, project_dir: Path, user_id: str, gemini_key: Optional[str]):
    project_dir.mkdir(parents=True, exist_ok=True)
    db_path = project_dir / "atlas.db"
    
    if db_path.exists():
        os.remove(db_path)

    db = Database(str(db_path))
    parser = CodeParser()
    ignore_checker = GitIgnoreChecker(str(source_dir))

    valid_files = []
    valid_extensions = {'.py', '.js', '.jsx', '.ts', '.tsx'}

    for root, dirs, files in os.walk(source_dir):
        root_path = Path(root)
        try:
            rel_root = str(root_path.relative_to(source_dir))
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
    if total == 0:
        asyncio.run(ws_manager.send_personal_message({"status": "Error", "message": "No supported source files found.", "percent": 0}, user_id))
        db.close()
        return

    try:
        for i, file in enumerate(valid_files, 1):
            asyncio.run(ws_manager.send_personal_message({
                "status": "Parsing AST...",
                "message": f"File {i} of {total}: {file.name}",
                "percent": int(10 + (i / total) * 45)
            }, user_id))
            try:
                db.save_module(parser.parse_file(str(file)))
            except Exception:
                pass
    finally:
        db.close()

    asyncio.run(ws_manager.send_personal_message({"status": "Linking APIs...", "message": "Detecting cross-language endpoints...", "percent": 65}, user_id))
    linker = APILinker(str(db_path))
    linker.run_linkage()

    # Cloud vectorization via Gemini
    effective_key = gemini_key or get_config(user_id).get("gemini_api_key")
    if effective_key:
        asyncio.run(ws_manager.send_personal_message({"status": "Vectorizing...", "message": "Generating Gemini embeddings...", "percent": 80}, user_id))
        embedder = EmbeddingService(str(db_path), api_key=effective_key)
        embedder.generate_embeddings()
    else:
        asyncio.run(ws_manager.send_personal_message({"status": "Finalizing...", "message": "Skipping vectors (No API key)...", "percent": 85}, user_id))

    asyncio.run(ws_manager.send_personal_message({"status": "Complete!", "message": "Code Atlas is ready.", "percent": 100}, user_id))


# --- INGESTION 1: GITHUB SNAPSHOT (FAST HTTP TARBALL) ---
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
        
        asyncio.run(ws_manager.send_personal_message({
            "status": "Downloading...", "message": f"Fetching {repo_name} archive...", "percent": 5
        }, uid))

        parts = clean_url.replace("https://github.com/", "").split("/")
        if len(parts) < 2:
            asyncio.run(ws_manager.send_personal_message({"status": "Error", "message": "Invalid GitHub URL.", "percent": 0}, uid))
            return
            
        owner, repo = parts[0], parts[1].replace(".git", "")
        temp_dir = Path(tempfile.mkdtemp(prefix=f"{uid}_{repo_name}_"))

        # Download zip snapshot via GitHub codeload
        download_success = False
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
            asyncio.run(ws_manager.send_personal_message({"status": "Error", "message": "Failed to download repository.", "percent": 0}, uid))
            shutil.rmtree(temp_dir, ignore_errors=True)
            return

        # Find extracted root folder
        extracted_roots = [d for d in temp_dir.iterdir() if d.is_dir()]
        target_src = extracted_roots[0] if extracted_roots else temp_dir

        try:
            execute_pipeline(target_src, project_dir, uid, key)
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)
            gc.collect()

    background_tasks.add_task(process_github, user_id, gemini_key)
    return {"status": "started", "project_name": repo_name}


# --- INGESTION 2: LOCAL PROJECT DRAG-AND-DROP (.ZIP UPLOAD) ---
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

        asyncio.run(ws_manager.send_personal_message({
            "status": "Unpacking...", "message": "Extracting uploaded archive...", "percent": 5
        }, uid))

        try:
            with zip_path.open("wb") as buffer:
                shutil.copyfileobj(file.file, buffer)

            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                zip_ref.extractall(temp_dir)
            os.remove(zip_path)

            extracted_roots = [d for d in temp_dir.iterdir() if d.is_dir()]
            target_src = extracted_roots[0] if (len(extracted_roots) == 1 and not any(temp_dir.glob("*.py"))) else temp_dir

            execute_pipeline(target_src, project_dir, uid, key)
        except Exception as e:
            asyncio.run(ws_manager.send_personal_message({"status": "Error", "message": f"Unpack failed: {str(e)}", "percent": 0}, uid))
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)
            gc.collect()

    background_tasks.add_task(process_zip, user_id, gemini_key)
    return {"status": "started", "project_name": clean_name}


# --- PROJECT QUERIES & GRAPH ---
@app.get("/api/projects")
def list_projects(user_id: str = Depends(get_client_id)):
    user_projects_dir = get_user_projects_dir(user_id)
    return [d.name for d in user_projects_dir.iterdir() if d.is_dir() and (d / "atlas.db").exists()]

@app.delete("/api/projects/{project_name}")
def delete_project(project_name: str, user_id: str = Depends(get_client_id)):
    user_projects_dir = get_user_projects_dir(user_id)
    project_dir = user_projects_dir / project_name
    
    cache_key = f"{user_id}_{project_name}"
    embedder_cache.pop(cache_key, None)
    ai_cache.pop(cache_key, None)
    gc.collect()

    if project_dir.exists() and project_dir.is_dir():
        shutil.rmtree(project_dir, ignore_errors=True)
        return {"status": "success", "message": f"Deleted {project_name}"}
            
    raise HTTPException(status_code=404, detail="Project not found")

@app.get("/api/graph/{project_name}")
def get_graph(project_name: str, user_id: str = Depends(get_client_id)):
    db_path = get_user_projects_dir(user_id) / project_name / "atlas.db"
    if not db_path.exists(): 
        raise HTTPException(status_code=404, detail="Project DB not found")
        
    analyzer = GraphAnalyzer(str(db_path))
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
    if not db_path.exists():
        raise HTTPException(status_code=404, detail="Project not found")
        
    import sqlite3
    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()
    for u in updates:
        if u.fx is None or u.fy is None:
            cursor.execute("DELETE FROM layout WHERE node_id = ?", (u.node_id,))
        else:
            cursor.execute("INSERT OR REPLACE INTO layout (node_id, fx, fy) VALUES (?, ?, ?)", (u.node_id, u.fx, u.fy))
    conn.commit()
    conn.close()
    return {"status": "success"}

@app.get("/api/search/{project_name}")
def search_codebase(
    project_name: str, 
    q: str = Query(...), 
    user_id: str = Depends(get_client_id),
    gemini_key: Optional[str] = Depends(get_client_gemini_key)
):
    db_path = get_user_projects_dir(user_id) / project_name / "atlas.db"
    if not db_path.exists():
        raise HTTPException(status_code=404, detail="Project not found")

    effective_key = gemini_key or get_config(user_id).get("gemini_api_key")
    embedder = EmbeddingService(str(db_path), api_key=effective_key)
    results = embedder.search(q, top_k=5)
    return {"query": q, "results": results}

@app.get("/api/node/{project_name}/{node_id:path}")
def get_node_details(project_name: str, node_id: str, user_id: str = Depends(get_client_id)):
    db_path = get_user_projects_dir(user_id) / project_name / "atlas.db"
    node_name = node_id.split('.')[-1]
    
    import sqlite3
    conn = sqlite3.connect(str(db_path))
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT n.name, n.node_type, n.parent_name, n.start_line, n.end_line, n.code_snippet, f.filepath
            FROM nodes n JOIN files f ON n.file_id = f.id WHERE n.name = ?
        """, (node_name,))
        
        for row in cursor.fetchall():
            name, node_type, parent_name, start_line, end_line, snippet, filepath = row
            mod_name = normalize_path(filepath)
            expected_id = f"{mod_name}.{parent_name}.{name}" if parent_name else f"{mod_name}.{name}"
            
            if expected_id == node_id:
                return {
                    "id": node_id, "name": name, "type": node_type, "filepath": filepath, 
                    "line_start": start_line, "line_end": end_line, "code": snippet,
                    "git": get_git_authors(filepath, start_line, end_line)
                }
    finally:
        conn.close()
        
    return {"id": node_id, "type": "module/package", "message": "No code snippet available."}

@app.post("/api/chat/{project_name}")
async def chat_endpoint(
    project_name: str, 
    req: ChatRequest, 
    user_id: str = Depends(get_client_id),
    gemini_key: Optional[str] = Depends(get_client_gemini_key)
):
    db_path = str((get_user_projects_dir(user_id) / project_name / "atlas.db").resolve())
    ai = CodeAtlasAI(db_path, user_id, api_key=gemini_key)
    return StreamingResponse(
        ai.stream_chat(req.node_id, req.message, req.selected_model), 
        media_type="text/plain"
    )

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)