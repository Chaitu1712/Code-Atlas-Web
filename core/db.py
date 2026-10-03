import sqlite3
import numpy as np
from typing import Dict, List, Tuple
from core.models import ParsedModule

class Database:
    def __init__(self, db_path: str = "atlas.db"):
        self.db_path = db_path
        self.conn = sqlite3.connect(db_path)
        self.cursor = self.conn.cursor()
        self._setup_tables()

    def _setup_tables(self):
        self.cursor.executescript("""
            CREATE TABLE IF NOT EXISTS files (
                id INTEGER PRIMARY KEY AUTOINCREMENT, 
                filepath TEXT UNIQUE
            );
            CREATE TABLE IF NOT EXISTS nodes (
                id INTEGER PRIMARY KEY AUTOINCREMENT, 
                file_id INTEGER, 
                name TEXT, 
                node_type TEXT, 
                parent_name TEXT, 
                start_line INTEGER, 
                end_line INTEGER, 
                code_snippet TEXT, 
                api_endpoint TEXT, 
                FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS imports (
                id INTEGER PRIMARY KEY AUTOINCREMENT, 
                file_id INTEGER, 
                imported_module TEXT, 
                imported_names TEXT, 
                line INTEGER, 
                FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS calls (
                id INTEGER PRIMARY KEY AUTOINCREMENT, 
                file_id INTEGER, 
                caller TEXT, 
                callee TEXT, 
                line INTEGER, 
                api_call TEXT, 
                FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS layout (
                node_id TEXT PRIMARY KEY, 
                fx REAL, 
                fy REAL
            );
            CREATE TABLE IF NOT EXISTS api_edges (
                id INTEGER PRIMARY KEY AUTOINCREMENT, 
                caller_node_id TEXT, 
                endpoint_node_id TEXT, 
                path TEXT
            );
            CREATE TABLE IF NOT EXISTS vectors (
                node_id INTEGER PRIMARY KEY, 
                embedding BLOB,
                FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
            );
        """)
        self.conn.commit()

    def save_module(self, module: ParsedModule):
        self.cursor.execute("INSERT OR REPLACE INTO files (filepath) VALUES (?)", (module.filepath,))
        file_id = self.cursor.execute("SELECT id FROM files WHERE filepath = ?", (module.filepath,)).fetchone()[0]

        self.cursor.execute("DELETE FROM nodes WHERE file_id = ?", (file_id,))
        self.cursor.execute("DELETE FROM imports WHERE file_id = ?", (file_id,))
        self.cursor.execute("DELETE FROM calls WHERE file_id = ?", (file_id,))

        for node in module.classes + module.functions:
            self.cursor.execute("""
                INSERT INTO nodes (file_id, name, node_type, parent_name, start_line, end_line, code_snippet, api_endpoint)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?);
            """, (file_id, node.name, node.node_type, node.parent_name, node.range.start_line, node.range.end_line, node.code_snippet, node.api_endpoint))

        for imp in module.imports:
            names_str = ",".join(imp.names)
            self.cursor.execute("""
                INSERT INTO imports (file_id, imported_module, imported_names, line)
                VALUES (?, ?, ?, ?)
            """, (file_id, imp.module, names_str, imp.line))

        for call in module.calls:
            self.cursor.execute("""
                INSERT INTO calls (file_id, caller, callee, line, api_call)
                VALUES (?, ?, ?, ?, ?)
            """, (file_id, call.caller, call.callee, call.line, call.api_call))

        self.conn.commit()

    def save_vectors(self, vector_map: Dict[int, np.ndarray]):
        for node_id, vec in vector_map.items():
            vec_bytes = vec.astype(np.float32).tobytes()
            self.cursor.execute("INSERT OR REPLACE INTO vectors (node_id, embedding) VALUES (?, ?)", (node_id, vec_bytes))
        self.conn.commit()

    def get_all_vectors(self) -> List[Tuple[int, np.ndarray]]:
        self.cursor.execute("SELECT node_id, embedding FROM vectors WHERE embedding IS NOT NULL")
        results = []
        for node_id, blob in self.cursor.fetchall():
            vec = np.frombuffer(blob, dtype=np.float32)
            results.append((node_id, vec))
        return results

    def close(self):
        self.conn.close()