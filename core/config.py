import json
from pathlib import Path
from typing import Dict, Any

def get_user_config_path(user_id: str) -> Path:
    safe_user = "".join(c for c in user_id if c.isalnum() or c in "-_") or "anonymous"
    config_path = Path(f"data/users/{safe_user}/config.json")
    config_path.parent.mkdir(parents=True, exist_ok=True)
    return config_path

def get_config(user_id: str) -> Dict[str, Any]:
    config_file = get_user_config_path(user_id)
    if not config_file.exists():
        return {
            "gemini_api_key": "",
            "active_online_model": "gemini-2.5-flash"
        }
    try:
        with open(config_file, "r") as f:
            return json.load(f)
    except Exception:
        return {"gemini_api_key": "", "active_online_model": "gemini-2.5-flash"}

def save_config(user_id: str, new_config: dict):
    config_file = get_user_config_path(user_id)
    with open(config_file, "w") as f:
        json.dump(new_config, f, indent=4)

def is_setup_complete(user_id: str) -> bool:
    config = get_config(user_id)
    return bool(config.get("gemini_api_key"))