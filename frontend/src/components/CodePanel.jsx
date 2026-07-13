import React, { useState, useEffect, useRef } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/atom-one-dark.css'; // Markdown code block theme
import { IconClose, IconAuthor, IconModifier } from './Icons';

export default function CodePanel({ viewingCode, setViewingCode, isCodeLoading, currentProject, authFetch }) {
    const [activeTab, setActiveTab] = useState('code'); 
    const [config, setConfig] = useState(null);
    const [mode, setMode] = useState('online');
    const [selectedModel, setSelectedModel] = useState('');
    
    // Chat State
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isThinking, setIsThinking] = useState(false);
    const messagesEndRef = useRef(null);

    // 1. Fetch config on mount
    useEffect(() => {
        const apiUrl= import.meta.env.VITE_API_URL || 'http://localhost:8000';
        authFetch(`${apiUrl}/api/config`)
            .then(res => res.json())
            .then(data => {
                setConfig(data.config);
                setMode(data.config.mode);
                setSelectedModel(data.config.mode === 'online' ? data.config.active_online_model : data.config.active_local_model);
            });
    }, []);

    // 2. Sync Mode/Model changes to Backend Config
    const handleConfigChange = async (newMode, newModel) => {
        setMode(newMode);
        setSelectedModel(newModel);
        
        // Update backend silently
        const updates = { mode: newMode };
        if (newMode === 'online') updates.active_online_model = newModel;
        else updates.active_local_model = newModel;
        const apiUrl= import.meta.env.VITE_API_URL || 'http://localhost:8000';
        await authFetch(`${apiUrl}/api/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
        
        // Refresh local config state
        const res = await authFetch(`${apiUrl}/api/config`);
        const data = await res.json();
        setConfig(data.config);
    };

    // 3. Clear chat when changing nodes
    useEffect(() => {
        if (viewingCode) setMessages([{ role: 'system', text: `Hi! I've loaded the architecture context for **\`${viewingCode.name}\`**. What would you like to know?` }]);
        setActiveTab('code');
    }, [viewingCode?.id]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, isThinking]);

    // 4. Handle Chat Stream
    const handleChatSubmit = async (e) => {
        e.preventDefault();
        if (!input.trim() || isThinking || !viewingCode || !currentProject) return;

        const userMsg = input.trim();
        setInput('');
        setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
        setIsThinking(true);
        setMessages(prev => [...prev, { role: 'assistant', text: '' }]);

        try {
            const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000';
            const response = await authFetch(`${apiUrl}/api/chat/${currentProject}`,  {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ node_id: viewingCode.id, message: userMsg, selected_model: selectedModel })
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value, { stream: true }); 
                setMessages(prev => {
                    const newMsgs = [...prev];
                    const lastIndex = newMsgs.length - 1;
                    newMsgs[lastIndex] = { 
                        ...newMsgs[lastIndex], 
                        text: newMsgs[lastIndex].text + chunk 
                    };
                    return newMsgs;
                });
            }
        } catch (err) {
            setMessages(prev => [...prev, { role: 'assistant', text: "\n\n**Error:** Failed to connect to AI Engine." }]);
        } finally {
            setIsThinking(false);
        }
    };

    const availableModels = mode === 'online' 
        ? [
            { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
            { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
            { value: "gemini-3-flash-preview", label: "Gemini 3 Flash" },
            { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" }
            
          ]
        : (config?.local_models || []).map(m => ({ value: m.path, label: m.name }));

    if (!viewingCode) return null;

    return (
        <div style={{ position: "absolute", top: 24, right: 24, width: "500px", zIndex: 10, background: "#ffffff", border: "1px solid rgba(0, 0, 0, 0.08)", borderRadius: "16px", boxShadow: "0 20px 40px -15px rgba(0, 0, 0, 0.1)", display: "flex", flexDirection: "column", maxHeight: "calc(100vh - 48px)" }}>
            
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "flex-start", background: "#f8fafc", borderRadius: "16px 16px 0 0" }}>
                <div style={{ flex: 1 }}>
                    <h3 style={{ margin: 0, color: "#0f172a", fontSize: "16px", fontWeight: 600 }}>{viewingCode.name || viewingCode.id.split('.').pop()}</h3>
                    <p style={{ margin: "4px 0 0 0", color: "#64748b", fontSize: "12px", fontFamily: "monospace" }}>{viewingCode.filepath ? `${viewingCode.filepath} : L${viewingCode.line_start}-${viewingCode.line_end}` : viewingCode.type}</p>
                    
                    {viewingCode.git && (
                        <div style={{ marginTop: "10px", display: "flex", gap: "10px", fontSize: "11px" }}>
                            <span style={{ background: "#e0e7ff", color: "#3730a3", padding: "4px 8px", borderRadius: "4px", fontWeight: 500, display: "flex", alignItems: "center", gap: "4px" }}><IconAuthor /> Orig: {viewingCode.git.original}</span>
                            <span style={{ background: "#fce7f3", color: "#9d174d", padding: "4px 8px", borderRadius: "4px", fontWeight: 500, display: "flex", alignItems: "center", gap: "4px" }}><IconModifier /> Mod: {viewingCode.git.heavy}</span>
                        </div>
                    )}
                    
                    <div style={{ display: "flex", gap: "10px", marginTop: "12px" }}>
                        <button onClick={() => setActiveTab('code')} style={{ padding: "6px 12px", border: "none", background: activeTab === 'code' ? "#e2e8f0" : "transparent", color: activeTab === 'code' ? "#0f172a" : "#64748b", borderRadius: "6px", cursor: "pointer", fontWeight: 600, fontSize: "12px" }}>Source Code</button>
                        <button onClick={() => setActiveTab('chat')} style={{ padding: "6px 12px", border: "none", background: activeTab === 'chat' ? "#dbeafe" : "transparent", color: activeTab === 'chat' ? "#2563eb" : "#64748b", borderRadius: "6px", cursor: "pointer", fontWeight: 600, fontSize: "12px" }}>Ask AI ✨</button>
                    </div>
                </div>
                <button onClick={() => setViewingCode(null)} style={{ background: "transparent", border: "none", cursor: "pointer" }}><IconClose /></button>
            </div>
            
            {activeTab === 'code' ? (
                <div style={{ padding: "0", flex: 1, overflowY: "auto", background: "#1e1e1e", borderRadius: "0 0 16px 16px" }}>
                    {isCodeLoading ? <div style={{ padding: "40px", textAlign: "center", color: "#94a3b8" }}>Loading syntax...</div> : viewingCode.code ? (
                        <SyntaxHighlighter language="python" style={vscDarkPlus} showLineNumbers={true} startingLineNumber={viewingCode.line_start} customStyle={{ margin: 0, padding: "20px", background: "transparent", fontSize: "13px" }}>{viewingCode.code}</SyntaxHighlighter>
                    ) : <div style={{ padding: "40px", textAlign: "center", color: "#94a3b8", background: "#f8fafc", height: "100%" }}>{viewingCode.message}</div>}
                </div>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", background: "#f8fafc", borderRadius: "0 0 16px 16px" }}>
                    
                    {/* --- UPGRADED: Mode Toggle & Model Selector --- */}
                    <div style={{ padding: "8px 16px", background: "#ffffff", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
                        
                        {/* Mode Switcher */}
                        <div style={{ display: "flex", background: "#f1f5f9", borderRadius: "6px", padding: "2px", border: "1px solid #e2e8f0" }}>
                            <button 
                                onClick={() => handleConfigChange('online', config.active_online_model)} 
                                style={{ padding: "4px 10px", border: "none", background: mode === 'online' ? "#ffffff" : "transparent", color: mode === 'online' ? "#2563eb" : "#64748b", borderRadius: "4px", fontSize: "11px", fontWeight: "bold", cursor: "pointer", boxShadow: mode === 'online' ? "0 1px 2px rgba(0,0,0,0.05)" : "none" }}>
                                ☁️ Cloud
                            </button>
                        </div>

                        {/* Dynamic Model Dropdown */}
                        <select 
                            value={selectedModel} 
                            onChange={e => handleConfigChange(mode, e.target.value)} 
                            style={{ padding: "4px 8px", borderRadius: "4px", border: "1px solid #cbd5e1", fontSize: "11px", outline: "none", background: "#f8fafc", flex: 1 }}
                        >
                            {availableModels.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                            {availableModels.length === 0 && <option value="">{mode === 'online' ? "No cloud models" : "No local models downloaded"}</option>}
                        </select>
                    </div>

                    {/* --- UPGRADED: Markdown Chat History --- */}
                                        <div style={{ flex: 1, overflowY: "auto", padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
                        {messages.map((msg, i) => (
                            <div key={i} style={{ display: "flex", justifyContent: msg.role === 'user' ? "flex-end" : "flex-start" }}>
                                <div style={{ 
                                    maxWidth: "90%", padding: "12px 16px", borderRadius: "12px", fontSize: "13px", lineHeight: "1.6",
                                    background: msg.role === 'user' ? "#2563eb" : "#ffffff", 
                                    color: msg.role === 'user' ? "#ffffff" : "#0f172a",
                                    border: msg.role === 'user' ? "none" : "1px solid #e2e8f0",
                                    boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                                    overflowX: "auto"
                                }}>
                                    
                                    {/* Render User message as plain text, Assistant as Markdown */}
                                    {msg.role === 'user' ? (
                                        <div style={{ whiteSpace: "pre-wrap" }}>{msg.text}</div>
                                    ) : (
                                        <ReactMarkdown rehypePlugins={[rehypeHighlight]} components={{
                                            p: ({node, ...props}) => <p style={{ margin: "0 0 10px 0" }} {...props} />,
                                            pre: ({node, ...props}) => <pre style={{ margin: "10px 0", borderRadius: "8px", background: "#1e1e1e", padding: "10px", overflowX: "auto" }} {...props} />,
                                            code: ({node, inline, className, children, ...props}) => {
                                                const match = /language-(\w+)/.exec(className || '')
                                                return !inline ? (
                                                    <code className={className} style={{ fontFamily: "monospace", fontSize: "12px" }} {...props}>{children}</code>
                                                ) : (
                                                    <code style={{ background: "rgba(0,0,0,0.05)", padding: "2px 4px", borderRadius: "4px", color: "#e11d48", fontFamily: "monospace" }} {...props}>{children}</code>
                                                )
                                            }
                                        }}>
                                            {msg.text}
                                        </ReactMarkdown>
                                    )}
                                    {msg.role === 'assistant' && msg.text === '' && isThinking && (
                                        <span style={{ animation: "pulse 1s infinite", color: "#94a3b8" }}>● ● ●</span>
                                    )}
                                </div>
                            </div>
                        ))}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input Area */}
                    <form onSubmit={handleChatSubmit} style={{ padding: "16px", background: "#ffffff", borderTop: "1px solid #e2e8f0" }}>
                        <div style={{ display: "flex", gap: "8px" }}>
                            <input type="text" value={input} onChange={e => setInput(e.target.value)} disabled={isThinking || availableModels.length === 0} placeholder={availableModels.length === 0 ? "No models available in this mode..." : "Ask about this architecture..."} style={{ flex: 1, padding: "12px", borderRadius: "8px", border: "1px solid #cbd5e1", outline: "none", fontSize: "13px" }} />
                            <button type="submit" disabled={isThinking || !input.trim() || availableModels.length === 0} style={{ padding: "0 16px", borderRadius: "8px", border: "none", background: "#0f172a", color: "#fff", fontWeight: 600, cursor: isThinking ? "wait" : "pointer", opacity: (!input.trim() || isThinking || availableModels.length === 0) ? 0.5 : 1 }}>Send</button>
                        </div>
                    </form>

                </div>
            )}
        </div>
    );
}