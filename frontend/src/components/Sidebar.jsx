import React from 'react';
import { Link } from 'react-router-dom';
import { IconHome, IconSearch, IconSettings } from './Icons';

export default function Sidebar({ 
    currentProject, detailLevel, setDetailLevel, query, setQuery, 
    handleSearch, isSearching, searchResults, selectedNode, setSelectedNode,
    onClearSearch
}) {
    const clearInput = () => {
        setQuery('');
        if (onClearSearch) onClearSearch();
    };

    return (
        <div style={{ 
            position: "absolute", top: 24, left: 24, width: "350px", zIndex: 10,
            background: "rgba(255, 255, 255, 0.88)", backdropFilter: "blur(16px)", 
            border: "1px solid rgba(0, 0, 0, 0.08)", borderRadius: "16px", padding: "20px", 
            boxShadow: "0 20px 40px -15px rgba(0, 0, 0, 0.08)", display: 'flex', flexDirection: 'column', 
            maxHeight: 'calc(100vh - 48px)', fontFamily: "Inter, sans-serif"
        }}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
                <div>
                    <h1 style={{ margin: 0, color: "#0f172a", fontSize: "22px", fontWeight: 800, letterSpacing: "-0.5px" }}>Code Atlas</h1>
                    <p style={{ margin: "2px 0 0 0", color: "#2563eb", fontSize: "13px", fontWeight: 600 }}>{currentProject}</p>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                    <Link to="/settings" style={{ background: "#f1f5f9", padding: "8px", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none", color: "#475569" }}>
                        <IconSettings />
                    </Link>
                    <Link to="/" style={{ background: "#f1f5f9", padding: "8px", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none", color: "#475569" }}>
                        <IconHome />
                    </Link>
                </div>
            </div>

            {/* Level Controls */}
            <div style={{ display: "flex", background: "rgba(0, 0, 0, 0.04)", borderRadius: "8px", padding: "3px", marginBottom: "14px" }}>
                {[1, 2, 3].map(level => (
                    <button key={level} onClick={() => setDetailLevel(level)}
                        style={{ 
                            flex: 1, padding: "6px", border: "none", borderRadius: "6px", cursor: "pointer", 
                            fontSize: "12px", background: detailLevel === level ? "#ffffff" : "transparent", 
                            color: detailLevel === level ? "#2563eb" : "#64748b", fontWeight: detailLevel === level ? 700 : 500, 
                            boxShadow: detailLevel === level ? "0 2px 4px rgba(0,0,0,0.05)" : "none", transition: "all 0.2s ease" 
                        }}>
                        Level {level}
                    </button>
                ))}
            </div>
            
            {/* Search Input */}
            <form onSubmit={handleSearch} style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
                <div style={{ position: "relative", flex: 1 }}>
                    <input 
                        type="text" 
                        value={query} 
                        onChange={(e) => setQuery(e.target.value)} 
                        placeholder="Search codebase architecture..." 
                        style={{ 
                            width: "100%", padding: "10px 32px 10px 12px", borderRadius: "8px", 
                            border: "1px solid #cbd5e1", background: "#ffffff", outline: "none", 
                            fontSize: "13px", boxSizing: "border-box" 
                        }} 
                    />
                    {query && (
                        <button 
                            type="button" 
                            onClick={clearInput}
                            style={{ 
                                position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", 
                                background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: "14px", fontWeight: "bold" 
                            }}
                        >
                            ✕
                        </button>
                    )}
                </div>
                <button 
                    type="submit" 
                    disabled={isSearching || !query.trim()} 
                    style={{ 
                        padding: "10px 16px", borderRadius: "8px", border: "none", fontSize: "13px", 
                        fontWeight: 600, background: "#2563eb", color: "white", cursor: isSearching ? "wait" : "pointer", 
                        display: "flex", alignItems: "center", gap: "6px" 
                    }}
                >
                    <IconSearch /> Find
                </button>
            </form>

            {/* Modern Animated Search Loader */}
            {isSearching ? (
                <div style={{ 
                    background: "linear-gradient(135deg, rgba(239, 246, 255, 0.8), rgba(248, 250, 252, 0.8))", 
                    borderRadius: "12px", padding: "28px 20px", 
                    border: "1px solid #bfdbfe", textAlign: "center" 
                }}>
                    {/* Animated Pulsing Sonar Ring */}
                    <div style={{ position: "relative", width: "48px", height: "48px", margin: "0 auto 12px auto" }}>
                        <div style={{
                            position: "absolute", inset: 0, borderRadius: "50%",
                            background: "rgba(37, 99, 235, 0.2)",
                            animation: "sonar 1.5s cubic-bezier(0, 0.2, 0.8, 1) infinite"
                        }} />
                        <div style={{
                            position: "relative", width: "48px", height: "48px", borderRadius: "50%",
                            background: "#2563eb", display: "flex", alignItems: "center", justifyContent: "center",
                            color: "#fff", fontSize: "20px"
                        }}>
                            ✨
                        </div>
                    </div>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: "#1e40af", marginBottom: "4px" }}>
                        Scanning Vector Embeddings...
                    </div>
                    <div style={{ fontSize: "11px", color: "#64748b" }}>
                        Comparing semantic cosine space
                    </div>

                    <style>{`
                        @keyframes sonar {
                            0% { transform: scale(0.9); opacity: 1; }
                            100% { transform: scale(1.8); opacity: 0; }
                        }
                    `}</style>
                </div>
            ) : searchResults.length > 0 ? (
                <div style={{ background: "rgba(255,255,255,0.7)", borderRadius: "12px", padding: "10px", border: "1px solid rgba(0,0,0,0.06)", overflowY: "auto", flex: 1 }}>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px", paddingLeft: "4px" }}>
                        {searchResults.length} Semantic Matches
                    </div>
                    {searchResults.map((res, i) => {
                        const matchPct = Math.max(0, Math.min(100, Math.round((1 - res.distance) * 100)));
                        const isSelected = selectedNode?.id === res.id;
                        return (
                            <div 
                                key={i} 
                                onClick={() => setSelectedNode(res)} 
                                style={{ 
                                    marginBottom: i !== searchResults.length - 1 ? "8px" : "0", 
                                    padding: "10px 12px", borderRadius: "8px", 
                                    background: isSelected ? "#eff6ff" : "#ffffff", 
                                    cursor: "pointer", 
                                    border: isSelected ? "1.5px solid #2563eb" : "1px solid #e2e8f0",
                                    transition: "all 0.15s ease"
                                }}
                            >
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <span style={{ color: "#0f172a", fontWeight: 700, fontSize: "13px" }}>{res.name}</span>
                                    <span style={{ 
                                        background: matchPct > 70 ? "#ecfdf5" : "#f1f5f9", 
                                        color: matchPct > 70 ? "#059669" : "#475569", 
                                        padding: "2px 6px", borderRadius: "4px", fontSize: "10px", fontWeight: 700 
                                    }}>
                                        {matchPct}% Match
                                    </span>
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "6px" }}>
                                    <span style={{ color: "#2563eb", fontSize: "11px", fontWeight: 600 }}>{res.type.toUpperCase()}</span>
                                    <span style={{ color: "#94a3b8", fontSize: "10px", maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {res.filepath}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : null}
        </div>
    );
}