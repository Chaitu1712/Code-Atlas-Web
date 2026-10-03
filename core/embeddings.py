import time
import re
import numpy as np
from pathlib import Path
from typing import List, Dict, Any, Optional, Callable
from google import genai
from core.strategies.path_normalizer import normalize_path
from core.db import Database, get_raw_connection
from core.config import get_config

class EmbeddingService:
    def __init__(
        self, 
        db_path: str, 
        project_id: str = "default", 
        api_key: Optional[str] = None,
        user_id: Optional[str] = None,
        progress_callback: Optional[Callable[[str, int], None]] = None
    ):
        self.db_path = str(Path(db_path).resolve())
        self.project_id = project_id
        self.api_key = api_key
        self.user_id = user_id
        self.progress_callback = progress_callback

        # Load user settings or default to safe Free Tier limits
        cfg = get_config(user_id) if user_id else {}
        self.model_name = cfg.get("embedding_model", "gemini-embedding-001")
        self.target_rpm = max(10, min(cfg.get("embedding_rpm", 80), 1000))
        self.request_delay = 60.0 / self.target_rpm

    def generate_embeddings(self):
        if not self.api_key:
            return

        conn = get_raw_connection(self.db_path)
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, name, node_type, code_snippet 
            FROM nodes 
            WHERE project_id = ? AND code_snippet IS NOT NULL AND LENGTH(code_snippet) > 20
            """, 
            (self.project_id,)
        )
        nodes = cursor.fetchall()
        conn.close()

        if not nodes:
            return

        client = genai.Client(api_key=self.api_key)
        vector_map = {}
        
        # Maximize batch size to 100 to reduce total HTTP requests by up to 70%
        BATCH_SIZE = 100
        total_batches = (len(nodes) + BATCH_SIZE - 1) // BATCH_SIZE

        print(f"🧠 [EMBEDDINGS] Embedding {len(nodes)} nodes in {total_batches} batches using '{self.model_name}' (Pacing: {self.target_rpm} RPM)...")

        for b_idx in range(total_batches):
            chunk = nodes[b_idx * BATCH_SIZE : (b_idx + 1) * BATCH_SIZE]
            node_ids = [row[0] for row in chunk]
            texts = [f"Type: {row[2]}\nName: {row[1]}\nCode:\n{row[3][:1500]}" for row in chunk]

            # Enforce pacing delay to prevent hitting RPM ceiling
            time.sleep(self.request_delay)

            max_retries = 3
            success = False

            for attempt in range(max_retries):
                try:
                    response = client.models.embed_content(
                        model=self.model_name,
                        contents=texts
                    )
                    
                    embeddings_list = getattr(response, "embeddings", None)
                    if embeddings_list:
                        for n_id, emb in zip(node_ids, embeddings_list):
                            vector_map[n_id] = np.array(emb.values, dtype=np.float32)
                    elif hasattr(response, "embedding"):
                        vector_map[node_ids[0]] = np.array(response.embedding.values, dtype=np.float32)
                    
                    success = True
                    break

                except Exception as e:
                    err_str = str(e)
                    
                    # 1. Detect Requests Per Day (RPD) exhaustion
                    if "RequestsPerDay" in err_str or "Day" in err_str:
                        msg = "❌ Daily Gemini Quota (RPD) exhausted! Quota resets at midnight Pacific Time."
                        print(f"⚠️ [QUOTA EXHAUSTED] {msg}")
                        if self.progress_callback:
                            self.progress_callback(msg, 85)
                        return

                    # 2. Detect Requests Per Minute (RPM) exhaustion
                    if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                        # Extract suggested retry delay from error if present (e.g. 'retry in 31s')
                        match = re.search(r'retry(?:ing)? in (\d+(?:\.\d+)?)s', err_str, re.IGNORECASE)
                        wait_seconds = float(match.group(1)) + 1.0 if match else 30.0

                        notice = f"⏳ Rate limit reached. Pausing {int(wait_seconds)}s to respect quota..."
                        print(f"⚠️ [RATE LIMIT] {notice}")
                        if self.progress_callback:
                            self.progress_callback(notice, 80)
                        
                        time.sleep(wait_seconds)
                        continue
                    
                    print(f"⚠️ [EMBEDDINGS ERROR] Batch {b_idx + 1} attempt {attempt + 1} failed: {e}")
                    break

            if not success:
                print(f"⚠️ Skipping batch {b_idx + 1} after {max_retries} failed attempts.")

        # Save all generated vectors
        if vector_map:
            db = Database(self.db_path, project_id=self.project_id)
            db.save_vectors(vector_map)
            db.close()
            print(f"✅ [EMBEDDINGS] Stored {len(vector_map)} vectors in database.")

    def search(self, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        if not self.api_key:
            return []

        db = Database(self.db_path, project_id=self.project_id)
        all_vectors = db.get_all_vectors()
        db.close()

        if not all_vectors:
            return []

        try:
            client = genai.Client(api_key=self.api_key)
            query_res = client.models.embed_content(
                model=self.model_name,
                contents=query
            )
            
            if hasattr(query_res, "embeddings") and query_res.embeddings:
                query_values = query_res.embeddings[0].values
            elif hasattr(query_res, "embedding"):
                query_values = query_res.embedding.values
            else:
                return []

            query_vec = np.array(query_values, dtype=np.float32)
        except Exception as e:
            print(f"⚠️ [SEARCH ERROR] {e}")
            return []

        node_ids = [item[0] for item in all_vectors]
        matrix = np.array([item[1] for item in all_vectors])

        dot_products = np.dot(matrix, query_vec)
        norms = (np.linalg.norm(matrix, axis=1) * np.linalg.norm(query_vec)) + 1e-10
        similarities = dot_products / norms

        top_indices = np.argsort(similarities)[::-1][:top_k]

        results = []
        conn = get_raw_connection(self.db_path)
        cursor = conn.cursor()
        try:
            for idx in top_indices:
                score = float(similarities[idx])
                if score < 0.2:
                    continue

                cursor.execute("""
                    SELECT n.name, n.node_type, n.parent_name, f.filepath, n.start_line
                    FROM nodes n JOIN files f ON n.file_id = f.id 
                    WHERE n.project_id = ? AND n.id = ?
                """, (self.project_id, node_ids[idx]))
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