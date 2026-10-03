import networkx as nx
from typing import Dict, List, Any
from collections import defaultdict

from core.strategies.path_normalizer import normalize_path
from core.strategies.import_resolver import resolve_import
from core.db import get_raw_connection

class GraphAnalyzer:
    def __init__(self, db_path: str = "atlas.db", project_id: str = "default"):
        self.db_path = db_path
        self.project_id = project_id
        self.conn = get_raw_connection(db_path)
        self.cursor = self.conn.cursor()
        self.graph = nx.DiGraph()

    def _add_packages(self, module_name: str):
        parts = module_name.split(".")
        for i in range(1, len(parts)):
            pkg_name = ".".join(parts[:i])
            parent_pkg = ".".join(parts[:i-1]) if i > 1 else None
            
            if not self.graph.has_node(pkg_name):
                self.graph.add_node(pkg_name, type="package", parent=parent_pkg)
            if parent_pkg and not self.graph.has_edge(parent_pkg, pkg_name):
                self.graph.add_edge(parent_pkg, pkg_name, type="contains")

    def build_module_graph(self):
        self.cursor.execute("SELECT id, filepath FROM files WHERE project_id = ?", (self.project_id,))
        
        files_dict = {}
        normalized_modules = {}
        all_parents = set()
        
        for row in self.cursor.fetchall():
            file_id, filepath = row
            files_dict[file_id] = filepath
            mod_name = normalize_path(filepath)
            normalized_modules[file_id] = mod_name
            parts = mod_name.split(".")
            for i in range(1, len(parts)):
                all_parents.add(".".join(parts[:i]))
        internal_modules = set(normalized_modules.values())

        for file_id, mod_name in normalized_modules.items():
            parent = ".".join(mod_name.split(".")[:-1]) if "." in mod_name else None
            node_type = "package" if mod_name in all_parents else "module_internal"
            if not self.graph.has_node(mod_name):
                self.graph.add_node(mod_name, type=node_type, parent=parent)
            self._add_packages(mod_name)
            if parent and not self.graph.has_edge(parent, mod_name):
                self.graph.add_edge(parent, mod_name, type="contains")

        self.cursor.execute("SELECT file_id, name, node_type, parent_name FROM nodes WHERE project_id = ?", (self.project_id,))
        nodes_lookup = defaultdict(list)
        
        for file_id, name, node_type, parent_name in self.cursor.fetchall():
            mod_name = normalized_modules[file_id]
            node_id = f"{mod_name}.{parent_name}.{name}" if parent_name else f"{mod_name}.{name}"
            parent_id = f"{mod_name}.{parent_name}" if parent_name else mod_name
                
            self.graph.add_node(node_id, type=node_type, parent=parent_id)
            self.graph.add_edge(parent_id, node_id, type="contains")
            nodes_lookup[name].append(node_id)

        self.cursor.execute("SELECT file_id, caller, callee FROM calls WHERE project_id = ?", (self.project_id,))
        for file_id, caller, callee in self.cursor.fetchall():
            mod_name = normalized_modules[file_id]
            caller_id = f"{mod_name}.{caller}" if caller != "global" else mod_name
            
            for callee_id in nodes_lookup.get(callee, []):
                if self.graph.has_node(caller_id) and self.graph.has_node(callee_id):
                    caller_parent = self.graph.nodes[caller_id].get('parent')
                    callee_parent = self.graph.nodes[callee_id].get('parent')
                    edge_type = "call_internal" if caller_parent == callee_parent else "call_external"
                    self.graph.add_edge(caller_id, callee_id, type=edge_type)

        self.cursor.execute("SELECT file_id, imported_module, imported_names FROM imports WHERE project_id = ?", (self.project_id,))
        for file_id, imported_module, imported_names_str in self.cursor.fetchall():
            source_filepath = files_dict[file_id]
            source_module = normalized_modules[file_id]
            imported_names = imported_names_str.split(",") if imported_names_str else []
            
            resolved = resolve_import(source_filepath, source_module, imported_module, internal_modules)
            if resolved not in internal_modules and not self.graph.has_node(resolved):
                self.graph.add_node(resolved, type="module_external")

            linked_deeply = False
            if imported_names and resolved in internal_modules:
                for name in imported_names:
                    pot_id = f"{resolved}.{name}"
                    if self.graph.has_node(pot_id):
                        self.graph.add_edge(pot_id, source_module, symbols=name, type="import")
                        linked_deeply = True

            if not linked_deeply:
                self.graph.add_edge(resolved, source_module, symbols=imported_names_str, type="import")

        self.cursor.execute("SELECT node_id, fx, fy FROM layout WHERE project_id = ?", (self.project_id,))
        for node_id, fx, fy in self.cursor.fetchall():
            if self.graph.has_node(node_id):
                self.graph.nodes[node_id]['fx'] = fx
                self.graph.nodes[node_id]['fy'] = fy

        self.cursor.execute("SELECT caller_node_id, endpoint_node_id, path FROM api_edges WHERE project_id = ?", (self.project_id,))
        for caller_id, endpoint_id, path in self.cursor.fetchall():
            if self.graph.has_node(caller_id) and self.graph.has_node(endpoint_id):
                self.graph.add_edge(caller_id, endpoint_id, type="api_call", path=path)

    def get_cyclic_dependencies(self) -> List[List[str]]:
        try:
            return list(nx.simple_cycles(self.graph))
        except Exception:
            return []

    def export_json(self) -> Dict[str, Any]:
        return nx.node_link_data(self.graph)