import sqlite3
from pathlib import Path
from typing import Optional, AsyncGenerator
from google import genai
from core.config import get_config

class CodeAtlasAI:
    def __init__(self, db_path: str, user_id: str, api_key: Optional[str] = None):
        self.db_path = db_path
        self.user_id = user_id
        self.api_key = api_key

    def _get_context(self, node_id: str) -> Optional[dict]:
        node_name = node_id.split('.')[-1]
        safe_db_path = Path(self.db_path).resolve()
        if not safe_db_path.exists():
            return None
            
        conn = sqlite3.connect(str(safe_db_path), timeout=10)
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT n.node_type, n.code_snippet, f.filepath 
                FROM nodes n JOIN files f ON n.file_id = f.id 
                WHERE n.name = ?
            """, (node_name,))
            row = cursor.fetchone()
            if not row: 
                return None
                
            node_type, snippet, filepath = row
            callers = [r[0] for r in cursor.execute("SELECT caller FROM calls WHERE callee = ?", (node_name,)).fetchall()]
            callees = [r[0] for r in cursor.execute("SELECT callee FROM calls WHERE caller = ?", (node_name,)).fetchall()]
            
            return {
                "name": node_id, 
                "type": node_type, 
                "filepath": filepath, 
                "code": snippet, 
                "callers": list(set(callers)), 
                "callees": list(set(callees))
            }
        finally:
            conn.close()

    async def stream_chat(self, node_id: str, user_message: str, selected_model: Optional[str] = "gemini-2.5-flash") -> AsyncGenerator[str, None]:
        context = self._get_context(node_id)
        if not context:
            yield "Error: Could not retrieve source code context for this architectural block."
            return

        key = self.api_key or get_config(self.user_id).get("gemini_api_key")
        if not key:
            yield "Error: Gemini API Key is missing. Connect your free API key in Settings."
            return

        system_prompt = (
            f"You are Code Atlas, a Staff Software Architect.\n"
            f"Analyzing: {context['name']} ({context['filepath']})\n"
            f"Called by: {', '.join(context['callers']) or 'None'}\n"
            f"Calls: {', '.join(context['callees']) or 'None'}\n\n"
            f"SOURCE CODE:\n```\n{context['code']}\n```"
        )

        try:
            client = genai.Client(api_key=key)
            model_name = selected_model or "gemini-2.5-flash"
            
            response = client.models.generate_content_stream(
                model=model_name, 
                contents=f"{system_prompt}\n\nUSER QUESTION: {user_message}"
            )
            for chunk in response:
                if chunk.text: 
                    yield chunk.text
        except Exception as e:
            yield f"\n\n[Gemini Error: {str(e)}]"