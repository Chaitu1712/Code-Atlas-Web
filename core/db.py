import os
import sqlite3
import numpy as np
from pathlib import Path
from typing import Dict, List, Tuple, Optional, Any
from core.models import ParsedModule
from dotenv import load_dotenv

load_dotenv()
# Check for Turso Cloud credentials
TURSO_URL = os.getenv("TURSO_DATABASE_URL")
TURSO_TOKEN = os.getenv("TURSO_AUTH_TOKEN")

def get_raw_connection(db_path: str = "atlas.db"):
    """
    Returns an active database connection.
    Connects to Turso Cloud if credentials exist, otherwise falls back to local SQLite.
    """
    if TURSO_URL and TURSO_TOKEN:
        try:
            import libsql
            return libsql.connect(database=TURSO_URL, auth_token=TURSO_TOKEN)
        except ImportError:
            print("⚠️ [DB] 'libsql' package not found. Falling back to local sqlite3. Run 'pip install libsql'.")
            return sqlite3.connect(db_path, timeout=15)
    return sqlite3.connect(db_path, timeout=15)


class Database:
    def __init__(self, db_path: str = "atlas.db", project_id: str = "default"):
        self.db_path = str(Path(db_path).resolve())
        self.project_id = project_id
        self.conn = get_raw_connection(self.db_path)
        self.cursor = self.conn.cursor()
        self._setup_tables()

    def _setup_tables(self):
        """Initializes tables using individual statements for reliable execution across drivers."""
        statements = [
            """
            CREATE TABLE IF NOT EXISTS files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT NOT NULL,
                filepath TEXT NOT NULL,
                UNIQUE(project_id, filepath)
            );
            """,
            """
            CREATE TABLE IF NOT EXISTS nodes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT NOT NULL,
                file_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                node_type TEXT NOT NULL,
                parent_name TEXT,
                start_line INTEGER,
                end_line INTEGER,
                code_snippet TEXT,
                api_endpoint TEXT,
                FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
            );
            """,
            """
            CREATE TABLE IF NOT EXISTS imports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT NOT NULL,
                file_id INTEGER NOT NULL,
                imported_module TEXT NOT NULL,
                imported_names TEXT,
                line INTEGER,
                FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
            );
            """,
            """
            CREATE TABLE IF NOT EXISTS calls (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT NOT NULL,
                file_id INTEGER NOT NULL,
                caller TEXT NOT NULL,
                callee TEXT NOT NULL,
                line INTEGER,
                api_call TEXT,
                FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
            );
            """,
            """
            CREATE TABLE IF NOT EXISTS layout (
                project_id TEXT NOT NULL,
                node_id TEXT NOT NULL,
                fx REAL,
                fy REAL,
                PRIMARY KEY(project_id, node_id)
            );
            """,
            """
            CREATE TABLE IF NOT EXISTS api_edges (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT NOT NULL,
                caller_node_id TEXT NOT NULL,
                endpoint_node_id TEXT NOT NULL,
                path TEXT
            );
            """,
            """
            CREATE TABLE IF NOT EXISTS vectors (
                project_id TEXT NOT NULL,
                node_id INTEGER NOT NULL,
                embedding BLOB NOT NULL,
                PRIMARY KEY(project_id, node_id)
            );
            """,
            "CREATE INDEX IF NOT EXISTS idx_files_project ON files(project_id);",
            "CREATE INDEX IF NOT EXISTS idx_nodes_project ON nodes(project_id);",
            "CREATE INDEX IF NOT EXISTS idx_calls_project ON calls(project_id);",
            "CREATE INDEX IF NOT EXISTS idx_imports_project ON imports(project_id);",
            "CREATE INDEX IF NOT EXISTS idx_vectors_project ON vectors(project_id);",
            "CREATE INDEX IF NOT EXISTS idx_edges_project ON api_edges(project_id);"
        ]
        
        for stmt in statements:
            self.cursor.execute(stmt)
        self.conn.commit()

    def clear_project_data(self):
        """Wipes any previous parse data for this specific project."""
        tables = ["files", "nodes", "imports", "calls", "layout", "api_edges", "vectors"]
        for table in tables:
            self.cursor.execute(f"DELETE FROM {table} WHERE project_id = ?", (self.project_id,))
        self.conn.commit()

    def save_module(self, module: ParsedModule):
        # 1. Insert or update file record
        self.cursor.execute(
            "INSERT OR REPLACE INTO files (project_id, filepath) VALUES (?, ?)", 
            (self.project_id, module.filepath)
        )
        self.cursor.execute(
            "SELECT id FROM files WHERE project_id = ? AND filepath = ?", 
            (self.project_id, module.filepath)
        )
        file_id = self.cursor.fetchone()[0]

        # 2. Clear old children for this file
        self.cursor.execute("DELETE FROM nodes WHERE project_id = ? AND file_id = ?", (self.project_id, file_id))
        self.cursor.execute("DELETE FROM imports WHERE project_id = ? AND file_id = ?", (self.project_id, file_id))
        self.cursor.execute("DELETE FROM calls WHERE project_id = ? AND file_id = ?", (self.project_id, file_id))

        # 3. Insert classes and functions
        for node in module.classes + module.functions:
            self.cursor.execute("""
                INSERT INTO nodes (project_id, file_id, name, node_type, parent_name, start_line, end_line, code_snippet, api_endpoint)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
            """, (
                self.project_id, file_id, node.name, node.node_type, 
                node.parent_name, node.range.start_line, node.range.end_line, 
                node.code_snippet, node.api_endpoint
            ))

        # 4. Insert imports
        for imp in module.imports:
            names_str = ",".join(imp.names)
            self.cursor.execute("""
                INSERT INTO imports (project_id, file_id, imported_module, imported_names, line)
                VALUES (?, ?, ?, ?, ?)
            """, (self.project_id, file_id, imp.module, names_str, imp.line))

        # 5. Insert function and API calls
        for call in module.calls:
            self.cursor.execute("""
                INSERT INTO calls (project_id, file_id, caller, callee, line, api_call)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (self.project_id, file_id, call.caller, call.callee, call.line, call.api_call))

        self.conn.commit()

    def save_vectors(self, vector_map: Dict[int, np.ndarray]):
        """Saves embedding float32 arrays as binary BLOBs."""
        for node_id, vec in vector_map.items():
            vec_bytes = vec.astype(np.float32).tobytes()
            self.cursor.execute(
                "INSERT OR REPLACE INTO vectors (project_id, node_id, embedding) VALUES (?, ?, ?)", 
                (self.project_id, node_id, vec_bytes)
            )
        self.conn.commit()

    def get_all_vectors(self) -> List[Tuple[int, np.ndarray]]:
        """Retrieves all vector embeddings for this project."""
        self.cursor.execute(
            "SELECT node_id, embedding FROM vectors WHERE project_id = ? AND embedding IS NOT NULL", 
            (self.project_id,)
        )
        results = []
        for node_id, blob in self.cursor.fetchall():
            vec = np.frombuffer(blob, dtype=np.float32)
            results.append((node_id, vec))
        return results

    def close(self):
        try:
            self.conn.close()
        except Exception:
            pass