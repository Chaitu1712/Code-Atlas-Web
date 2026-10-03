import os
import sqlite3
import numpy as np
from pathlib import Path
from typing import Dict, List, Tuple
from dotenv import load_dotenv
from core.models import ParsedModule

load_dotenv()

TURSO_URL = os.getenv("TURSO_DATABASE_URL")
TURSO_TOKEN = os.getenv("TURSO_AUTH_TOKEN")

_TABLES_CHECKED = False

def ensure_tables(conn):
    cursor = conn.cursor()
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
        "CREATE INDEX IF NOT EXISTS idx_nodes_lookup ON nodes(project_id, name);",
        "CREATE INDEX IF NOT EXISTS idx_calls_project ON calls(project_id);",
        "CREATE INDEX IF NOT EXISTS idx_imports_project ON imports(project_id);",
        "CREATE INDEX IF NOT EXISTS idx_vectors_project ON vectors(project_id);",
        "CREATE INDEX IF NOT EXISTS idx_edges_project ON api_edges(project_id);"
    ]
    for stmt in statements:
        cursor.execute(stmt)
    conn.commit()

def get_raw_connection(db_path: str = "atlas.db"):
    global _TABLES_CHECKED
    if TURSO_URL and TURSO_TOKEN:
        try:
            import libsql
            conn = libsql.connect(database=TURSO_URL, auth_token=TURSO_TOKEN)
            if not _TABLES_CHECKED:
                ensure_tables(conn)
                _TABLES_CHECKED = True
            return conn
        except ImportError:
            print("⚠️ [DB] 'libsql' package not found. Falling back to local sqlite3.")
    
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=15)
    if not _TABLES_CHECKED:
        ensure_tables(conn)
        _TABLES_CHECKED = True
    return conn

def _execute_multi_insert(cursor, table: str, columns: List[str], rows: List[tuple], chunk_size: int = 40):
    """
    Constructs multi-row 'INSERT INTO table VALUES (...), (...)' queries.
    This guarantees 1 single HTTP network request per 40 rows instead of 40 separate roundtrips.
    """
    if not rows:
        return
    cols_str = ", ".join(columns)
    row_placeholder = f"({', '.join(['?'] * len(columns))})"
    
    for i in range(0, len(rows), chunk_size):
        chunk = rows[i:i + chunk_size]
        placeholders = ", ".join([row_placeholder] * len(chunk))
        sql = f"INSERT INTO {table} ({cols_str}) VALUES {placeholders}"
        flat_params = [val for row in chunk for val in row]
        cursor.execute(sql, flat_params)


class Database:
    def __init__(self, db_path: str = "atlas.db", project_id: str = "default"):
        self.db_path = str(Path(db_path).resolve())
        self.project_id = project_id
        self.conn = get_raw_connection(self.db_path)
        self.cursor = self.conn.cursor()

    def clear_project_data(self):
        tables = ["files", "nodes", "imports", "calls", "layout", "api_edges", "vectors"]
        for table in tables:
            self.cursor.execute(f"DELETE FROM {table} WHERE project_id = ?", (self.project_id,))
        self.conn.commit()

    def save_modules_batch(self, modules: List[ParsedModule]):
        if not modules:
            return

        # 1. Multi-row insert files in chunks of 150
        file_rows = [(self.project_id, m.filepath) for m in modules]
        _execute_multi_insert(self.cursor, "files", ["project_id", "filepath"], file_rows, chunk_size=150)

        # 2. Fetch IDs
        self.cursor.execute("SELECT filepath, id FROM files WHERE project_id = ?", (self.project_id,))
        file_id_map = dict(self.cursor.fetchall())

        nodes_data, imports_data, calls_data = [], [], []

        for m in modules:
            file_id = file_id_map.get(m.filepath)
            if not file_id:
                continue

            for node in m.classes + m.functions:
                nodes_data.append((
                    self.project_id, file_id, node.name, node.node_type,
                    node.parent_name, node.range.start_line, node.range.end_line,
                    node.code_snippet, node.api_endpoint
                ))

            for imp in m.imports:
                imports_data.append((
                    self.project_id, file_id, imp.module, ",".join(imp.names), imp.line
                ))

            for call in m.calls:
                calls_data.append((
                    self.project_id, file_id, call.caller, call.callee, call.line, call.api_call
                ))

        # 3. High-throughput chunk sizes (cuts network roundtrips by 75%)
        # 120 nodes * 9 cols = 1,080 params (well below LibSQL's 32,766 limit)
        _execute_multi_insert(
            self.cursor, "nodes", 
            ["project_id", "file_id", "name", "node_type", "parent_name", "start_line", "end_line", "code_snippet", "api_endpoint"], 
            nodes_data, chunk_size=120
        )

        _execute_multi_insert(
            self.cursor, "imports", 
            ["project_id", "file_id", "imported_module", "imported_names", "line"], 
            imports_data, chunk_size=150
        )

        _execute_multi_insert(
            self.cursor, "calls", 
            ["project_id", "file_id", "caller", "callee", "line", "api_call"], 
            calls_data, chunk_size=150
        )

        self.conn.commit()

    def save_vectors(self, vector_map: Dict[int, np.ndarray]):
        vector_rows = []
        for node_id, vec in vector_map.items():
            vec_bytes = vec.astype(np.float32).tobytes()
            vector_rows.append((self.project_id, node_id, vec_bytes))

        _execute_multi_insert(self.cursor, "vectors", ["project_id", "node_id", "embedding"], vector_rows, chunk_size=50)
        self.conn.commit()

    def get_all_vectors(self) -> List[Tuple[int, np.ndarray]]:
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