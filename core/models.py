from pydantic import BaseModel
from typing import List, Optional

class CodeRange(BaseModel):
    start_line: int
    end_line: int
    start_byte: int
    end_byte: int

class ParsedNode(BaseModel):
    name: str
    node_type: str
    range: CodeRange
    code_snippet: Optional[str] = None
    parent_name: Optional[str] = None
    api_endpoint: Optional[str] = None
     
class ParsedImport(BaseModel):
    module: str
    names: List[str] = []
    line: int

class ParsedCall(BaseModel):
    caller: str
    callee: str
    line: int
    api_call: Optional[str] = None

class ParsedModule(BaseModel):
    filepath: str
    classes: List[ParsedNode] = []
    functions: List[ParsedNode] = []
    imports: List[ParsedImport] = []
    calls: List[ParsedCall] = [] 

class LayoutUpdate(BaseModel):
    node_id: str
    fx: Optional[float] = None
    fy: Optional[float] = None

class ChatRequest(BaseModel):
    node_id: str
    message: str
    selected_model: Optional[str] = "gemini-2.5-flash"

class GithubRequest(BaseModel):
    github_url: str
    project_name: Optional[str] = None