import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AddProjectModal from '../components/AddProjectModal';
import { IconHistory, IconFolder, IconAdd, IconRocket, IconSettings } from '../components/Icons';
import { apiFetch, getClientId } from '../utils/apiClient';

export default function LandingPage({ onOpenKeyModal }) {
    const [projects, setProjects] = useState([]);
    const [recentProjects, setRecentProjects] = useState([]);
    const [showModal, setShowModal] = useState(false);
    const navigate = useNavigate();

    const fetchProjects = () => {
        apiFetch('/api/projects')
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data)) {
                    setProjects(data);
                    const savedRecents = JSON.parse(localStorage.getItem('codeAtlasRecents') || '[]');
                    setRecentProjects(savedRecents.filter(p => data.includes(p)).slice(0, 3));
                }
            })
            .catch(() => {});
    };

    useEffect(() => { fetchProjects(); }, []);

    return (
        <div style={{ minHeight: "100vh", backgroundColor: "#f7f9fb", padding: "48px 24px", fontFamily: "Inter, sans-serif" }}>
            {showModal && (
                <AddProjectModal 
                    onClose={() => setShowModal(false)} 
                    onSuccess={(newProjectName) => { 
                        setShowModal(false); 
                        navigate(`/visualize/${newProjectName}`); 
                    }} 
                />
            )}
            
            <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
                
                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "48px" }}>
                    <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                            <img src="/logo.png" alt="Code Atlas" style={{ width: "40px", height: "40px", borderRadius: "10px" }} />
                            <h1 style={{ fontSize: "36px", fontWeight: "800", color: "#0f172a", margin: 0, letterSpacing: "-0.02em" }}>
                                Code Atlas
                            </h1>
                        </div>
                        <p style={{ color: "#64748b", fontSize: "16px", margin: "6px 0 0 0" }}>
                            Interactive 3D architecture maps for complex codebases.
                        </p>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <button
                            onClick={onOpenKeyModal}
                            style={{
                                display: "flex", alignItems: "center", gap: "6px",
                                background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: "8px",
                                padding: "8px 14px", fontSize: "13px", fontWeight: 600, color: "#334155", cursor: "pointer"
                            }}
                        >
                            ✨ Gemini Key
                        </button>
                        <Link 
                            to="/settings"
                            style={{
                                display: "flex", alignItems: "center", gap: "6px",
                                background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: "8px",
                                padding: "8px 14px", fontSize: "13px", fontWeight: 600, color: "#334155", textDecoration: "none"
                            }}
                        >
                            <IconSettings /> Settings
                        </Link>
                    </div>
                </div>

                {/* Primary Action Hero */}
                <div style={{ display: "flex", gap: "24px", marginBottom: "48px", flexWrap: "wrap" }}>
                    <div 
                        onClick={() => setShowModal(true)} 
                        style={{ 
                            flex: "1 1 500px", backgroundColor: "#ffffff", border: "2px dashed #cbd5e1", 
                            borderRadius: "16px", padding: "48px 32px", display: "flex", flexDirection: "column", 
                            alignItems: "center", justifyContent: "center", cursor: "pointer", 
                            transition: "all 0.2s ease" 
                        }} 
                        onMouseEnter={e => { e.currentTarget.style.borderColor = "#2563eb"; e.currentTarget.style.backgroundColor = "#f8fafc"; }} 
                        onMouseLeave={e => { e.currentTarget.style.borderColor = "#cbd5e1"; e.currentTarget.style.backgroundColor = "#ffffff"; }}
                    >
                        <div style={{ backgroundColor: "#eff6ff", color: "#2563eb", width: "52px", height: "52px", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "16px" }}>
                            <IconAdd />
                        </div>
                        <h3 style={{ margin: 0, color: "#0f172a", fontSize: "20px", fontWeight: "700" }}>
                            Parse New Codebase
                        </h3>
                        <p style={{ color: "#64748b", fontSize: "14px", marginTop: "8px", textAlign: "center" }}>
                            Import directly from a <strong>GitHub Repository</strong> or drag & drop a local <strong>.ZIP file</strong>.
                        </p>
                    </div>

                    <div style={{ 
                        flex: "0 0 340px", backgroundColor: "#ffffff", borderRadius: "16px", padding: "28px", 
                        boxShadow: "0 4px 20px rgba(0, 0, 0, 0.03)", border: "1px solid #e2e8f0" 
                    }}>
                        <h3 style={{ margin: "0 0 20px 0", color: "#0f172a", fontSize: "18px", fontWeight: "700", display: "flex", alignItems: "center", gap: "8px" }}>
                            <IconRocket /> How It Works
                        </h3>
                        <div style={{ display: "flex", flexDirection: "column", gap: "16px", fontSize: "13px", color: "#475569" }}>
                            <div>1. <strong>Provide Source:</strong> Paste a GitHub link or upload a zipped codebase.</div>
                            <div>2. <strong>AST Extraction:</strong> Tree-sitter maps classes, methods, and API calls.</div>
                            <div>3. <strong>Dependency Graph:</strong> NetworkX identifies cross-language links and cycles.</div>
                            <div>4. <strong>Interactive Map:</strong> Pan, zoom, inspect source, and query with Gemini.</div>
                        </div>
                    </div>
                </div>

                {/* Recents Section */}
                {recentProjects.length > 0 && (
                    <div style={{ marginBottom: "40px" }}>
                        <h2 style={{ fontSize: "20px", fontWeight: "700", color: "#0f172a", display: "flex", alignItems: "center", gap: "8px", marginBottom: "20px" }}>
                            <IconHistory /> Jump Back In
                        </h2>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "20px" }}>
                            {recentProjects.map((p) => (
                                <div 
                                    key={p} 
                                    onClick={() => navigate(`/visualize/${p}`)} 
                                    style={{ 
                                        backgroundColor: "#ffffff", border: "1px solid #e2e8f0", padding: "20px", 
                                        borderRadius: "12px", cursor: "pointer", transition: "all 0.2s ease"
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.borderColor = "#2563eb"; e.currentTarget.style.transform = "translateY(-2px)"; }} 
                                    onMouseLeave={e => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.transform = "translateY(0)"; }}
                                >
                                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                                        <IconFolder />
                                        <h3 style={{ margin: 0, color: "#0f172a", fontSize: "16px", fontWeight: "600" }}>{p}</h3>
                                    </div>
                                    <span style={{ color: "#2563eb", fontSize: "13px", fontWeight: 600 }}>Open Interactive Map ➔</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div style={{ textAlign: "center", borderTop: "1px solid #e2e8f0", paddingTop: "24px" }}>
                    <Link to="/projects" style={{ color: "#2563eb", textDecoration: "none", fontWeight: "600", fontSize: "14px" }}>
                        View All {projects.length} Saved Projects ➔
                    </Link>
                </div>
            </div>
        </div>
    );
}