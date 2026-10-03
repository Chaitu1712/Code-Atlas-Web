import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { IconHome, IconCloud, IconLock } from '../components/Icons';
import { apiFetch, getGeminiKey, setGeminiKey, getClientId } from '../utils/apiClient';

export default function SettingsPage({ onKeyUpdated }) {
    const [geminiKey, setKeyInput] = useState(getGeminiKey());
    const [savedMessage, setSavedMessage] = useState(false);

    useEffect(() => {
        apiFetch('/api/config')
            .then(res => res.json())
            .then(data => {
                if (data.config?.gemini_api_key && !geminiKey) {
                    setKeyInput(data.config.gemini_api_key);
                }
            })
            .catch(() => {});
    }, []);

    const saveApiKey = async (e) => {
        e.preventDefault();
        setGeminiKey(geminiKey);
        await apiFetch('/api/config', {
            method: 'POST',
            body: JSON.stringify({ gemini_api_key: geminiKey.trim() })
        });
        setSavedMessage(true);
        if (onKeyUpdated) onKeyUpdated();
        setTimeout(() => setSavedMessage(false), 3000);
    };

    return (
        <div style={{ minHeight: "100vh", background: "#f8fafc", padding: "48px 20px", fontFamily: "Inter, sans-serif" }}>
            <div style={{ maxWidth: "800px", margin: "0 auto" }}>
                
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "32px" }}>
                    <div>
                        <h1 style={{ fontSize: "28px", color: "#0f172a", margin: 0, fontWeight: 800 }}>Settings</h1>
                        <p style={{ margin: "4px 0 0 0", color: "#64748b", fontSize: "14px" }}>Configure external AI keys and environment parameters.</p>
                    </div>
                    <Link to="/" style={{ color: "#2563eb", textDecoration: "none", display: "flex", alignItems: "center", gap: "6px", fontWeight: 600, fontSize: "14px" }}>
                        <IconHome /> Back to Map
                    </Link>
                </div>

                <div style={{ background: "#ffffff", borderRadius: "16px", border: "1px solid #e2e8f0", padding: "32px", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.02)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                        <IconCloud />
                        <h2 style={{ fontSize: "18px", margin: 0, color: "#0f172a", fontWeight: 700 }}>Google Gemini Engine</h2>
                    </div>
                    <p style={{ color: "#64748b", fontSize: "13px", marginBottom: "24px" }}>
                        Your API key powers the conversational architecture assistant and semantic code search.
                    </p>

                    {savedMessage && (
                        <div style={{ padding: "10px 14px", borderRadius: "8px", marginBottom: "20px", fontSize: "13px", background: "#ecfdf5", color: "#059669", border: "1px solid #a7f3d0" }}>
                            ✅ Configuration saved successfully!
                        </div>
                    )}

                    <form onSubmit={saveApiKey}>
                        <label style={{ display: "block", marginBottom: "20px" }}>
                            <span style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "8px" }}>Gemini API Key</span>
                            <div style={{ display: "flex", alignItems: "center", border: "1px solid #cbd5e1", borderRadius: "8px", padding: "0 12px", background: "#f8fafc" }}>
                                <IconLock />
                                <input 
                                    type="password" 
                                    value={geminiKey} 
                                    onChange={e => setKeyInput(e.target.value)} 
                                    placeholder="AIzaSy..." 
                                    style={{ width: "100%", padding: "12px", border: "none", background: "transparent", outline: "none", fontSize: "14px" }} 
                                />
                            </div>
                        </label>

                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #f1f5f9", paddingTop: "20px" }}>
                            <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb", fontSize: "13px", fontWeight: 600, textDecoration: "underline" }}>
                                Get a free key at Google AI Studio ↗
                            </a>
                            <button type="submit" style={{ padding: "10px 24px", borderRadius: "8px", border: "none", background: "#2563eb", color: "white", fontWeight: "bold", cursor: "pointer" }}>
                                Save Key
                            </button>
                        </div>
                    </form>

                    <div style={{ marginTop: "32px", paddingTop: "20px", borderTop: "1px solid #f1f5f9", fontSize: "12px", color: "#94a3b8" }}>
                        Client Fingerprint: <code style={{ background: "#f1f5f9", padding: "2px 6px", borderRadius: "4px" }}>{getClientId()}</code>
                    </div>
                </div>
            </div>
        </div>
    );
}