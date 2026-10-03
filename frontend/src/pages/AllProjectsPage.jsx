import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AddProjectModal from '../components/AddProjectModal';
import { IconPlus, IconTrash, IconPlay } from '../components/Icons';
import { apiFetch } from '../utils/apiClient';

export default function AllProjectsPage() {
    const [projects, setProjects] = useState([]);
    const [showModal, setShowModal] = useState(false);
    const navigate = useNavigate();

    const fetchProjects = () => {
        apiFetch('/api/projects')
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data)) setProjects(data);
            })
            .catch(err => console.error("Failed to load projects", err));
    };

    useEffect(() => { fetchProjects(); }, []);

    const handleDelete = async (e, p) => {
        e.stopPropagation();
        if (window.confirm(`Are you sure you want to permanently delete "${p}"?`)) {
            await apiFetch(`/api/projects/${p}`, { method: 'DELETE' });
            fetchProjects();
        }
    };

    return (
        <div style={{ minHeight: "100vh", backgroundColor: "#f7f9fb", padding: "64px 24px", fontFamily: "Inter, sans-serif" }}>
            {showModal && (
                <AddProjectModal 
                    onClose={() => setShowModal(false)} 
                    onSuccess={(newProject) => { 
                        setShowModal(false); 
                        navigate(`/visualize/${newProject}`); 
                    }} 
                />
            )}

            <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "48px", flexWrap: "wrap", gap: "20px" }}>
                    <div>
                        <h1 style={{ fontSize: "40px", fontWeight: "800", color: "#0f172a", margin: "0 0 8px 0" }}>All Projects</h1>
                        <p style={{ color: "#64748b", fontSize: "16px", margin: 0 }}>Manage your parsed codebases on this device.</p>
                    </div>
                    
                    <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
                        <Link to="/" style={{ color: "#64748b", textDecoration: "none", fontWeight: "600", fontSize: "14px" }}>
                            Dashboard
                        </Link>
                        <button 
                            onClick={() => setShowModal(true)}
                            style={{ 
                                backgroundColor: "#2563eb", color: "#ffffff", border: "none", borderRadius: "8px", 
                                padding: "10px 20px", fontSize: "14px", fontWeight: "600", cursor: "pointer", 
                                display: "flex", alignItems: "center", gap: "8px"
                            }}
                        >
                            <IconPlus /> New Project
                        </button>
                    </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: "24px" }}>
                    {projects.map((p) => (
                        <div 
                            key={p} 
                            onClick={() => navigate(`/visualize/${p}`)} 
                            style={{ 
                                backgroundColor: "#ffffff", borderRadius: "12px", padding: "24px", 
                                cursor: "pointer", border: "1px solid #e2e8f0", transition: "all 0.2s ease",
                                display: "flex", flexDirection: "column", height: "160px"
                            }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = "#2563eb"; e.currentTarget.style.transform = "translateY(-2px)"; }} 
                            onMouseLeave={e => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.transform = "translateY(0)"; }}
                        >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                <h3 style={{ margin: 0, color: "#0f172a", fontSize: "20px", fontWeight: "600" }}>{p}</h3>
                                <button 
                                    onClick={(e) => handleDelete(e, p)} 
                                    style={{ background: "#fee2e2", color: "#dc2626", border: "none", padding: "6px", borderRadius: "6px", cursor: "pointer" }}
                                    title="Delete Project"
                                >
                                    <IconTrash />
                                </button>
                            </div>

                            <div style={{ marginTop: "auto" }}>
                                <span style={{ color: "#2563eb", fontSize: "13px", fontWeight: "600", display: "flex", alignItems: "center", gap: "6px" }}>
                                    Open Architecture Map <IconPlay />
                                </span>
                            </div>
                        </div>
                    ))}
                </div>

                {projects.length === 0 && (
                    <div style={{ textAlign: "center", padding: "80px 20px", backgroundColor: "#ffffff", border: "1px dashed #cbd5e1", borderRadius: "12px" }}>
                        <p style={{ color: "#64748b", fontSize: "16px", margin: "0 0 16px 0" }}>No codebases parsed yet.</p>
                        <button 
                            onClick={() => setShowModal(true)}
                            style={{ backgroundColor: "transparent", color: "#2563eb", border: "none", fontSize: "15px", fontWeight: "600", cursor: "pointer", textDecoration: "underline" }}
                        >
                            Parse your first project
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}