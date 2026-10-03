import React, { useState, useEffect, useRef } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/atom-one-dark.css';
import { IconClose, IconAuthor, IconModifier } from './Icons';
import { apiFetch } from '../utils/apiClient';

export default function CodePanel({ viewingCode, setViewingCode, isCodeLoading, currentProject, onNavigateNode }) {
    const [activeTab, setActiveTab] = useState('code');
    const [selectedModel, setSelectedModel] = useState('gemini-2.5-flash');
    const [copied, setCopied] = useState(false);

    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isThinking, setIsThinking] = useState(false);
    const messagesEndRef = useRef(null);

    // Detect Syntax Highlighter Language dynamically
    const getLanguage = (filepath) => {
        if (!filepath) return 'javascript';
        if (filepath.endsWith('.py')) return 'python';
        if (filepath.endsWith('.ts') || filepath.endsWith('.tsx')) return 'typescript';
        if (filepath.endsWith('.jsx')) return 'jsx';
        if (filepath.endsWith('.json')) return 'json';
        return 'javascript';
    };

    const handleCopy = () => {
        if (viewingCode?.code) {
            navigator.clipboard.writeText(viewingCode.code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    useEffect(() => {
        if (viewingCode) {
            setMessages([{
                role: 'system',
                text: `Context loaded for **\`${viewingCode.name}\`**. What breaks if we change this? Ask any architectural question.`
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
        { value: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite" },
        { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
        { value: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
        { value: "gemini-3.7-flash", label: "Gemini 3.7 Flash" },
        { value: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
    ];

    if (!viewingCode) return null;

    return (
        <div style={{
            position: "absolute", top: 24, right: 24, width: "480px", zIndex: 20,
            background: "#ffffff", border: "1px solid rgba(0, 0, 0, 0.08)", borderRadius: "16px",
            boxShadow: "0 20px 40px -15px rgba(0, 0, 0, 0.15)", display: "flex", flexDirection: "column",
            maxHeight: "calc(100vh - 48px)", fontFamily: "Inter, sans-serif"
        }}>

            {/* Header */}
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc", borderRadius: "16px 16px 0 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1, paddingRight: "10px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <h3 style={{ margin: 0, color: "#0f172a", fontSize: "16px", fontWeight: 700 }}>
                                {viewingCode.name || viewingCode.id.split('.').pop()}
                            </h3>
                            <span style={{ background: "#e2e8f0", color: "#475569", padding: "1px 6px", borderRadius: "4px", fontSize: "10px", fontWeight: 700, textTransform: "uppercase" }}>
                                {viewingCode.type}
                            </span>
                        </div>
                        <p style={{ margin: "4px 0 0 0", color: "#64748b", fontSize: "12px", fontFamily: "monospace" }}>
                            {viewingCode.filepath ? `${viewingCode.filepath} : L${viewingCode.line_start}-${viewingCode.line_end}` : viewingCode.type}
                        </p>
                    </div>
                    <button onClick={() => setViewingCode(null)} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#94a3b8" }}>
                        <IconClose size={18} />
                    </button>
                </div>

                {/* Git Metadata or Snapshot Status */}
                {viewingCode.git ? (
                    <div style={{ marginTop: "10px", display: "flex", gap: "8px", fontSize: "11px" }}>
                        <span style={{ background: "#e0e7ff", color: "#3730a3", padding: "3px 8px", borderRadius: "4px", fontWeight: 600, display: "flex", alignItems: "center", gap: "4px" }}>
                            <IconAuthor /> Orig: {viewingCode.git.original}
                        </span>
                        <span style={{ background: "#fce7f3", color: "#9d174d", padding: "3px 8px", borderRadius: "4px", fontWeight: 600, display: "flex", alignItems: "center", gap: "4px" }}>
                            <IconModifier /> Mod: {viewingCode.git.heavy}
                        </span>
                    </div>
                ) : (
                    <div style={{ marginTop: "8px", fontSize: "11px", color: "#94a3b8", display: "flex", alignItems: "center", gap: "5px" }}>
                        <span>📦</span> <span>Static snapshot (No Git commit history)</span>
                    </div>
                )}

                {/* Interactive Callers & Callees Jump Navigator */}
                {((viewingCode.callers && viewingCode.callers.length > 0) || (viewingCode.callees && viewingCode.callees.length > 0)) && (
                    <div style={{ marginTop: "10px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
                        {viewingCode.callers?.map((caller, i) => (
                            <span
                                key={`caller-${i}`}
                                onClick={() => onNavigateNode && onNavigateNode(caller)}
                                title={`Jump to caller on map: ${caller}`}
                                style={{
                                    background: "#fdf2f8", color: "#db2777", border: "1px solid #fbcfe8",
                                    padding: "3px 10px", borderRadius: "12px", fontSize: "11px", fontWeight: 600,
                                    cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "4px",
                                    transition: "all 0.15s ease"
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = "#fce7f3"}
                                onMouseLeave={e => e.currentTarget.style.background = "#fdf2f8"}
                            >
                                ⬅ Called by <strong>{caller.split('.').pop()}</strong>
                            </span>
                        ))}
                        {viewingCode.callees?.map((callee, i) => (
                            <span
                                key={`callee-${i}`}
                                onClick={() => onNavigateNode && onNavigateNode(callee)}
                                title={`Jump to callee on map: ${callee}`}
                                style={{
                                    background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0",
                                    padding: "3px 10px", borderRadius: "12px", fontSize: "11px", fontWeight: 600,
                                    cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "4px",
                                    transition: "all 0.15s ease"
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = "#dcfce7"}
                                onMouseLeave={e => e.currentTarget.style.background = "#f0fdf4"}
                            >
                                Calls <strong>{callee.split('.').pop()}</strong> ➔
                            </span>
                        ))}
                    </div>
                )}

                {/* Action Tabs & Copy Button */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "12px" }}>
                    <div style={{ display: "flex", gap: "8px" }}>
                        <button
                            onClick={() => setActiveTab('code')}
                            style={{
                                padding: "5px 12px", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: 600, fontSize: "12px",
                                background: activeTab === 'code' ? "#e2e8f0" : "transparent",
                                color: activeTab === 'code' ? "#0f172a" : "#64748b"
                            }}
                        >
                            Source Code
                        </button>
                        <button
                            onClick={() => setActiveTab('chat')}
                            style={{
                                padding: "5px 12px", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: 600, fontSize: "12px",
                                background: activeTab === 'chat' ? "#dbeafe" : "transparent",
                                color: activeTab === 'chat' ? "#2563eb" : "#64748b"
                            }}
                        >
                            Ask AI ✨
                        </button>
                    </div>

                    {activeTab === 'code' && viewingCode.code && (
                        <button
                            onClick={handleCopy}
                            style={{
                                background: "none", border: "1px solid #cbd5e1", borderRadius: "6px",
                                padding: "4px 8px", fontSize: "11px", fontWeight: 600, color: copied ? "#059669" : "#475569",
                                cursor: "pointer", display: "flex", alignItems: "center", gap: "4px"
                            }}
                        >
                            {copied ? "✅ Copied!" : "📋 Copy"}
                        </button>
                    )}
                </div>
            </div>

            {/* Content Area */}
            {activeTab === 'code' ? (
                <div style={{ padding: 0, flex: 1, overflowY: "auto", background: "#1e1e1e", borderRadius: "0 0 16px 16px" }}>
                    {isCodeLoading ? (
                        <div style={{ padding: "40px", textAlign: "center", color: "#94a3b8" }}>Loading syntax...</div>
                    ) : viewingCode.code ? (
                        <SyntaxHighlighter
                            language={getLanguage(viewingCode.filepath)}
                            style={vscDarkPlus}
                            showLineNumbers={true}
                            startingLineNumber={viewingCode.line_start}
                            customStyle={{ margin: 0, padding: "16px", background: "transparent", fontSize: "13px", lineHeight: "1.5" }}
                        >
                            {viewingCode.code}
                        </SyntaxHighlighter>
                    ) : (
                        <div style={{ padding: "40px", textAlign: "center", color: "#94a3b8", background: "#f8fafc", height: "100%" }}>
                            {viewingCode.message || "No code snippet available."}
                        </div>
                    )}
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

                    <div style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
                        {messages.map((msg, i) => (
                            <div key={i} style={{ display: "flex", justifyContent: msg.role === 'user' ? "flex-end" : "flex-start" }}>
                                <div style={{
                                    maxWidth: "90%", padding: "10px 14px", borderRadius: "10px", fontSize: "13px", lineHeight: "1.5",
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

                    <form onSubmit={handleChatSubmit} style={{ padding: "14px", background: "#ffffff", borderTop: "1px solid #e2e8f0" }}>
                        <div style={{ display: "flex", gap: "8px" }}>
                            <input
                                type="text"
                                value={input}
                                onChange={e => setInput(e.target.value)}
                                disabled={isThinking}
                                placeholder="Ask about this function's architecture..."
                                style={{ flex: 1, padding: "10px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", outline: "none", fontSize: "13px" }}
                            />
                            <button type="submit" disabled={isThinking || !input.trim()} style={{ padding: "0 16px", borderRadius: "8px", border: "none", background: "#0f172a", color: "#fff", fontWeight: 600, cursor: "pointer" }}>Send</button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
}