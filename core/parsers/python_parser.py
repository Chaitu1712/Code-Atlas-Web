import tree_sitter_python as tspython
from tree_sitter import Language, Parser, Query, QueryCursor
from core.models import ParsedModule, ParsedNode, CodeRange, ParsedImport, ParsedCall
import re

class PythonParser:
    def __init__(self):
        self.language = Language(tspython.language())
        self.parser = Parser(self.language)
        self.struct_query = Query(self.language, "(class_definition name: (identifier) @class.name) @class.def\n(function_definition name: (identifier) @func.name) @func.def")
        self.import_query = Query(self.language, "(import_statement) @import\n(import_from_statement) @import_from")
        self.call_query = Query(self.language, "(call function: (_) @call.func)")

    def _get_enclosing_scope(self, node):
        current, func_name, class_name = node.parent, None, None
        while current:
            if current.type == 'function_definition' and not func_name:
                for child in current.children:
                    if child.type == 'identifier': func_name = child.text.decode('utf8'); break
            elif current.type == 'class_definition' and not class_name:
                for child in current.children:
                    if child.type == 'identifier': class_name = child.text.decode('utf8'); break
            current = current.parent
        if class_name and func_name: return f"{class_name}.{func_name}"
        elif func_name: return func_name
        elif class_name: return class_name
        return "global"

    def parse_file(self, filepath: str) -> ParsedModule:
        with open(filepath, 'rb') as f: source_code = f.read()
        tree = self.parser.parse(source_code)
        module = ParsedModule(filepath=filepath)

        for match in QueryCursor(self.struct_query).matches(tree.root_node):
            captures = match[1]
            if "class.def" in captures:
                module.classes.append(self._create_node(captures["class.name"][0].text.decode('utf8'), 'class', captures["class.def"][0], source_code))
            elif "func.def" in captures:
                func_node = captures["func.def"][0]
                extract_node = func_node
                if func_node.parent and func_node.parent.type == 'decorated_definition':
                    extract_node = func_node.parent
                parsed_node = self._create_node(captures["func.name"][0].text.decode('utf8'), 'function', extract_node, source_code)
                scope = self._get_enclosing_scope(func_node.parent)
                if scope != "global": parsed_node.parent_name = scope
                
                api_match = re.search(r'@.*?\.(get|post|put|delete|patch)\([\'"]([^\'"]+)[\'"]\)', parsed_node.code_snippet, re.IGNORECASE)
                if api_match:
                    method, path = api_match.groups()
                    parsed_node.api_endpoint = f"{method.upper()} {path}"
                consumer_match = re.search(r'(?:requests|httpx|session|client)\.(get|post|put|delete|patch)\([\'"]([^\'"]+)[\'"]\)', parsed_node.code_snippet, re.IGNORECASE)
                if consumer_match:
                    method, path = consumer_match.groups()
                    api_call_str = f"{method.upper()} {path}"
                    # Add to the calls list
                    module.calls.append(ParsedCall(
                        caller=scope, callee="API", line=func_node.start_point[0]+1, api_call=api_call_str
                    ))
                
                module.functions.append(parsed_node)

        for match in QueryCursor(self.import_query).matches(tree.root_node):
            captures = match[1]
            if "import" in captures:
                for node in captures["import"]:
                    for child in node.children:
                        if child.type == 'dotted_name': module.imports.append(ParsedImport(module=child.text.decode('utf8'), line=node.start_point[0]+1))
            elif "import_from" in captures:
                for node in captures["import_from"]:
                    parts = [c.text.decode('utf8') for c in node.children if c.type not in ['from', 'import']]
                    if len(parts) >= 1: module.imports.append(ParsedImport(module=parts[0], line=node.start_point[0]+1))

        for match in QueryCursor(self.call_query).matches(tree.root_node):
            if "call.func" in match[1]:
                func_node = match[1]["call.func"][0]
                callee_name = func_node.child_by_field_name('attribute').text.decode('utf8') if func_node.type == 'attribute' else func_node.text.decode('utf8')
                module.calls.append(ParsedCall(caller=self._get_enclosing_scope(func_node), callee=callee_name, line=func_node.start_point[0] + 1))

        return module

    def _create_node(self, name, node_type, node, source_code) -> ParsedNode:
        snippet = source_code[node.start_byte:node.end_byte].decode('utf8')
        return ParsedNode(name=name, node_type=node_type, range=CodeRange(start_line=node.start_point[0]+1, end_line=node.end_point[0]+1, start_byte=node.start_byte, end_byte=node.end_byte), code_snippet=snippet)