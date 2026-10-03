import re
from core.strategies.path_normalizer import normalize_path
from core.db import get_raw_connection

class APILinker:
    def __init__(self, db_path: str, project_id: str = "default"):
        self.db_path = db_path
        self.project_id = project_id

    def _normalize_route(self, route: str) -> str:
        route = re.sub(r'https?://[^/]+', '', route)
        route = re.sub(r'\$\{[^}]+\}', '{}', route)
        route = re.sub(r'\{[^}]+\}', '{}', route)
        if route.endswith('/') and len(route) > 1:
            route = route[:-1]
        return route.strip().upper()

    def run_linkage(self):
        conn = get_raw_connection(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("DELETE FROM api_edges WHERE project_id = ?", (self.project_id,))

        cursor.execute("""
            SELECT f.filepath, n.parent_name, n.name, n.api_endpoint 
            FROM nodes n JOIN files f ON n.file_id = f.id 
            WHERE n.project_id = ? AND n.api_endpoint IS NOT NULL
        """, (self.project_id,))
        
        endpoints = []
        for filepath, parent, name, endpoint in cursor.fetchall():
            mod_name = normalize_path(filepath)
            node_id = f"{mod_name}.{parent}.{name}" if parent else f"{mod_name}.{name}"
            clean_endpoint = self._normalize_route(endpoint)
            endpoints.append((clean_endpoint, node_id, endpoint))

        cursor.execute("""
            SELECT f.filepath, c.caller, c.api_call 
            FROM calls c JOIN files f ON c.file_id = f.id 
            WHERE c.project_id = ? AND c.api_call IS NOT NULL
        """, (self.project_id,))
        consumers = cursor.fetchall()
        
        match_count = 0
        for filepath, caller, api_call in consumers:
            mod_name = normalize_path(filepath)
            caller_id = f"{mod_name}.{caller}" if caller != "global" else mod_name
            clean_call = self._normalize_route(api_call)
            
            for clean_endpoint, target_id, original_endpoint in endpoints:
                if clean_call == clean_endpoint or clean_endpoint in clean_call:
                    cursor.execute("""
                        INSERT INTO api_edges (project_id, caller_node_id, endpoint_node_id, path) 
                        VALUES (?, ?, ?, ?)
                    """, (self.project_id, caller_id, target_id, original_endpoint))
                    match_count += 1

        conn.commit()
        conn.close()