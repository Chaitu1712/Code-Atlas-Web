import sqlite3
import numpy as np
from pathlib import Path
from typing import List, Dict, Any, Optional
from google import genai
from core.strategies.path_normalizer import normalize_path

class EmbeddingService:
    def __init__(self, db_path: str, api_key: Optional[str] = None):
        self.db_path = str(Path(db_path).resolve())
        self.api_key = api_key

    def generate_embeddings(self):
        if not self.api_key:
            print("⚠️ [EMBEDDINGS] No Gemini API key provided. Skipping semantic embedding generation.")
            return

        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, node_type, code_snippet FROM nodes WHERE code_snippet IS NOT NULL")
        nodes = cursor.fetchall()
        conn.close()

        if not nodes:
            return

        client = genai.Client(api_key=self.api_key)
        vector_map = {}

        # Batch embed in groups of 20 to prevent payload limits
        batch_size = 20
        for i in range(0, len(nodes), batch_size):
            chunk = nodes[i:i + batch_size]
            node_ids = [row[0] for row in chunk]
            texts = [f"Type: {row[2]}\nName: {row[1]}\nCode:\n{row[3][:1500]}" for row in chunk]

            try:
                for n_id, text in zip(node_ids, texts):
                    response = client.models.embed_content(
                        model="text-embedding-004",
                        contents=text
                    )
                    # Extract embedding vector
                    values = response.embeddings[0].values if hasattr(response, "embeddings") else response.embedding.values
                    vector_map[n_id] = np.array(values, dtype=np.float32)
            except Exception as e:
                print(f"⚠️ [EMBEDDINGS ERROR] Failed batch: {e}")
                continue

        if vector_map:
            from core.db import Database
            db = Database(self.db_path)
            db.save_vectors(vector_map)
            db.close()
            print(f"✅ [EMBEDDINGS] Successfully stored {len(vector_map)} vectors in database.")

    def search(self, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        if not self.api_key:
            return []

        from core.db import Database
        db = Database(self.db_path)
        all_vectors = db.get_all_vectors()
        db.close()

        if not all_vectors:
            return []

        try:
            client = genai.Client(api_key=self.api_key)
            query_res = client.models.embed_content(
                model="text-embedding-004",
                contents=query
            )
            query_values = query_res.embeddings[0].values if hasattr(query_res, "embeddings") else query_res.embedding.values
            query_vec = np.array(query_values, dtype=np.float32)
        except Exception as e:
            print(f"⚠️ [SEARCH ERROR] Gemini embedding request failed: {e}")
            return []

        node_ids = [item[0] for item in all_vectors]
        matrix = np.array([item[1] for item in all_vectors])

        # Cosine similarity
        dot_products = np.dot(matrix, query_vec)
        norms = (np.linalg.norm(matrix, axis=1) * np.linalg.norm(query_vec)) + 1e-10
        similarities = dot_products / norms

        top_indices = np.argsort(similarities)[::-1][:top_k]

        results = []
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        try:
            for idx in top_indices:
                score = float(similarities[idx])
                if score < 0.25:  # Relevance threshold
                    continue

                target_id = node_ids[idx]
                cursor.execute("""
                    SELECT n.name, n.node_type, n.parent_name, f.filepath, n.start_line
                    FROM nodes n JOIN files f ON n.file_id = f.id WHERE n.id = ?
                """, (target_id,))
                row = cursor.fetchone()
                if row:
                    name, node_type, parent_name, filepath, start_line = row
                    mod_name = normalize_path(filepath)
                    full_node_id = f"{mod_name}.{parent_name}.{name}" if parent_name else f"{mod_name}.{name}"

                    results.append({
                        "distance": 1.0 - score,
                        "id": full_node_id,
                        "name": name,
                        "type": node_type,
                        "filepath": filepath,
                        "line": start_line
                    })
        finally:
            conn.close()

        return results