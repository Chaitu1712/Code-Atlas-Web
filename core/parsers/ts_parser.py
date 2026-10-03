import tree_sitter_typescript as tsts
from tree_sitter import Language, Parser, Query, QueryCursor
from core.models import ParsedModule, ParsedNode, CodeRange, ParsedCall, ParsedImport
import re

class TSParser:
    def __init__(self):
        self.language = Language(tsts.language_typescript())
        self.parser = Parser(self.language)
        
        self.struct_query = Query(self.language, """
            (class_declaration name: (type_identifier) @class.name) @class.def
            (function_declaration name: (identifier) @func.name) @func.def
            (lexical_declaration (variable_declarator name: (identifier) @func.name value: [(arrow_function) (function_expression)])) @func.def
        """)
        
        self.import_query = Query(self.language, "(import_statement) @import")

    def parse_file(self, filepath: str) -> ParsedModule:
        with open(filepath, 'rb') as f: 
            source_code = f.read()
            
        tree = self.parser.parse(source_code)
        module = ParsedModule(filepath=filepath)

        for match in QueryCursor(self.struct_query).matches(tree.root_node):
            captures = match[1]
            if "class.def" in captures:
                module.classes.append(self._create_node(captures["class.name"][0].text.decode('utf8'), 'class', captures["class.def"][0], source_code))
            elif "func.def" in captures:
                node = captures["func.def"][0]
                name = captures["func.name"][0].text.decode('utf8')
                parsed_node = self._create_node(name, 'function', node, source_code)
                
                endpoint_match = re.search(r'(?:app|router|server|@)\.?(get|post|put|delete|patch)\([\'"`]([^\'"`]+)[\'"`]', parsed_node.code_snippet, re.IGNORECASE)
                if endpoint_match:
                    method= (endpoint_match.group(1) or 'get').upper()
                    path = endpoint_match.group(2)
                    parsed_node.api_endpoint = f"{method.upper()} {path}"
                
                consumer_match = re.search(r'(?:fetch|(?:axios|http|api|client|request)\.(get|post|put|delete|patch))\([\'"`]([^\'"`]+)[\'"`]', parsed_node.code_snippet, re.IGNORECASE)
                if consumer_match:
                    method = (consumer_match.group(1) or 'get').upper()
                    path = consumer_match.group(2)
                    api_call_str = f"{method} {path}"
                    module.calls.append(ParsedCall(caller=name, callee="API", line=node.start_point[0]+1, api_call=api_call_str))
                
                module.functions.append(parsed_node)

        for match in QueryCursor(self.import_query).matches(tree.root_node):
            if "import" in match[1]:
                for node in match[1]["import"]:
                    source_node = node.child_by_field_name("source")
                    if not source_node: continue
                    
                    source_module = source_node.text.decode('utf8').strip("'\"`")
                    
                    imported_names = []
                    clause_node = node.child_by_field_name("import")
                    if clause_node:
                        def find_identifiers(n):
                            if n.type == 'identifier':
                                imported_names.append(n.text.decode('utf8'))
                            for child in n.children:
                                find_identifiers(child)
                        find_identifiers(clause_node)
                        
                    module.imports.append(ParsedImport(
                        module=source_module, 
                        names=imported_names, 
                        line=node.start_point[0] + 1
                    ))

        return module

    def _create_node(self, name, node_type, node, source_code) -> ParsedNode:
        snippet = source_code[node.start_byte:node.end_byte].decode('utf8')
        return ParsedNode(
            name=name, node_type=node_type, 
            range=CodeRange(start_line=node.start_point[0]+1, end_line=node.end_point[0]+1, start_byte=node.start_byte, end_byte=node.end_byte), 
            code_snippet=snippet
        )