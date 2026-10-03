import React, { useState, useEffect, useRef } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/atom-one-dark.css';
import { IconClose, IconAuthor, IconModifier } from './Icons';
import { apiFetch } from '../utils/apiClient';

export default function CodePanel({ viewingCode, setViewingCode, isCodeLoading, currentProject }) {
    const [activeTab, setActiveTab] = useState('code'); 
    const [selectedModel, setSelectedModel] = useState('gemini-2.5-flash');
    
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isThinking, setIsThinking] = useState(false);
    const messagesEndRef = useRef(null);

    useEffect(() => {
        if (viewingCode) {
            setMessages([{ 
                role: 'system', 
                text: `Loaded context for **\`${viewingCode.name}\`**. Ask me anything about its callers, callees, or architecture.` 
            }]);
        }
        setActiveTab('code');
    }, [viewingCode?.id]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, isThinking]);

    const handleChatSubmit = async (e) => {
        e.preventDefault();
        if (!input.trim() || isThinking || !viewingCode || !currentProject) return;

        const userMsg = input.trim();
        setInput('');
        setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
        setIsThinking(true);
        setMessages(prev => [...prev, { role: 'assistant', text: '' }]);

        try {
            const response = await apiFetch(`/api/chat/${currentProject}`, {
                method: 'POST',
                body: JSON.stringify({ 
                    node_id: viewingCode.id, 
                    message: userMsg, 
                    selected_model: selectedModel 
                })
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value, { stream: true }); 
                setMessages(prev => {
                    const newMsgs = [...prev];
                    const lastIdx = newMsgs.length - 1;
                    newMsgs[lastIdx] = { 
                        ...newMsgs[lastIdx], 
                        text: newMsgs[lastIdx].text + chunk 
                    };
                    return newMsgs;
                });
            }
        } catch (err) {
            setMessages(prev => [...prev, { role: 'assistant', text: "\n\n⚠️ Failed to connect to AI engine." }]);
        } finally {
            setIsThinking(false);
        }
    };

    const models = [
        { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (Fast)" },
        { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro (Deep Reasoning)" }
    ];

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
                    <div style={{ padding: "8px 16px", background: "#ffffff", borderBottom: "1px solid #e2e8f0" }}>
                        <select 
                            value={selectedModel} 
                            onChange={e => setSelectedModel(e.target.value)} 
                            style={{ width: "100%", padding: "6px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12px", background: "#f8fafc" }}
                        >
                            {models.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </select>
                    </div>

                    <div style={{ flex: 1, overflowY: "auto", padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
                        {messages.map((msg, i) => (
                            <div key={i} style={{ display: "flex", justifyContent: msg.role === 'user' ? "flex-end" : "flex-start" }}>
                                <div style={{ 
                                    maxWidth: "90%", padding: "12px 16px", borderRadius: "12px", fontSize: "13px", lineHeight: "1.6",
                                    background: msg.role === 'user' ? "#2563eb" : "#ffffff", 
                                    color: msg.role === 'user' ? "#ffffff" : "#0f172a",
                                    border: msg.role === 'user' ? "none" : "1px solid #e2e8f0",
                                    boxShadow: "0 1px 2px rgba(0,0,0,0.05)"
                                }}>
                                    {msg.role === 'user' ? (
                                        <div style={{ whiteSpace: "pre-wrap" }}>{msg.text}</div>
                                    ) : (
                                        <ReactMarkdown rehypePlugins={[rehypeHighlight]}>
                                            {msg.text}
                                        </ReactMarkdown>
                                    )}
                                </div>
                            </div>
                        ))}
                        <div ref={messagesEndRef} />
                    </div>

                    <form onSubmit={handleChatSubmit} style={{ padding: "16px", background: "#ffffff", borderTop: "1px solid #e2e8f0" }}>
                        <div style={{ display: "flex", gap: "8px" }}>
                            <input 
                                type="text" 
                                value={input} 
                                onChange={e => setInput(e.target.value)} 
                                disabled={isThinking} 
                                placeholder="Ask about this architecture..." 
                                style={{ flex: 1, padding: "10px 14px", borderRadius: "8px", border: "1px solid #cbd5e1", outline: "none", fontSize: "13px" }} 
                            />
                            <button type="submit" disabled={isThinking || !input.trim()} style={{ padding: "0 16px", borderRadius: "8px", border: "none", background: "#0f172a", color: "#fff", fontWeight: 600, cursor: "pointer" }}>Send</button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
}