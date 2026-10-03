import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { IconHome, IconCloud, IconLock } from '../components/Icons';
import { apiFetch, getGeminiKey, setGeminiKey, getClientId } from '../utils/apiClient';

export default function SettingsPage({ onKeyUpdated }) {
    const [geminiKey, setKeyInput] = useState(getGeminiKey());
    const [embeddingModel, setEmbeddingModel] = useState('gemini-embedding-001');
    const [embeddingRpm, setEmbeddingRpm] = useState(80);
    const [accountTier, setAccountTier] = useState('free');
    const [savedMessage, setSavedMessage] = useState(false);

    useEffect(() => {
        apiFetch('/api/config')
            .then(res => res.json())
            .then(data => {
                const cfg = data.config || {};
                if (cfg.gemini_api_key && !geminiKey) setKeyInput(cfg.gemini_api_key);
                if (cfg.embedding_model) setEmbeddingModel(cfg.embedding_model);
                if (cfg.embedding_rpm) setEmbeddingRpm(cfg.embedding_rpm);
                if (cfg.account_tier) setAccountTier(cfg.account_tier);
            })
            .catch(() => {});
    }, []);

    const maxRpmLimit = accountTier === 'paid' ? 1500 : 100;

    const saveSettings = async (e) => {
        e.preventDefault();
        setGeminiKey(geminiKey);
        
        await apiFetch('/api/config', {
            method: 'POST',
            body: JSON.stringify({ 
                gemini_api_key: geminiKey.trim(),
                embedding_model: embeddingModel,
                embedding_rpm: Number(embeddingRpm),
                account_tier: accountTier
            })
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
                        <p style={{ margin: "4px 0 0 0", color: "#64748b", fontSize: "14px" }}>Configure AI keys, vector embedding engines, and API rate limits.</p>
                    </div>
                    <Link to="/" style={{ color: "#2563eb", textDecoration: "none", display: "flex", alignItems: "center", gap: "6px", fontWeight: 600, fontSize: "14px" }}>
                        <IconHome /> Back to Dashboard
                    </Link>
                </div>

                <div style={{ background: "#ffffff", borderRadius: "16px", border: "1px solid #e2e8f0", padding: "32px", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.02)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                        <IconCloud />
                        <h2 style={{ fontSize: "18px", margin: 0, color: "#0f172a", fontWeight: 700 }}>Google Gemini Configuration</h2>
                    </div>

                    {savedMessage && (
                        <div style={{ padding: "10px 14px", borderRadius: "8px", margin: "16px 0", fontSize: "13px", background: "#ecfdf5", color: "#059669", border: "1px solid #a7f3d0" }}>
                            ✅ Configuration saved successfully!
                        </div>
                    )}

                    <form onSubmit={saveSettings}>
                        {/* API Key */}
                        <label style={{ display: "block", marginTop: "20px", marginBottom: "24px" }}>
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

                        {/* Model Selection */}
                        <label style={{ display: "block", marginBottom: "24px" }}>
                            <span style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "8px" }}>Embedding Model</span>
                            <select
                                value={embeddingModel}
                                onChange={e => setEmbeddingModel(e.target.value)}
                                style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #cbd5e1", background: "#f8fafc", fontSize: "13px" }}
                            >
                                <option value="gemini-embedding-001">Gemini Embedding 1 (gemini-embedding-001) - Stable GA</option>
                                <option value="gemini-embedding-2-preview">Gemini Embedding 2 (gemini-embedding-2-preview) - SOTA Code Benchmarks (+8.0 MTEB)</option>
                            </select>
                        </label>

                        {/* Account Tier Toggle */}
                        <div style={{ marginBottom: "24px" }}>
                            <span style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "8px" }}>Google AI Studio Plan</span>
                            <div style={{ display: "flex", gap: "12px" }}>
                                <button
                                    type="button"
                                    onClick={() => { setAccountTier('free'); setEmbeddingRpm(Math.min(embeddingRpm, 100)); }}
                                    style={{
                                        flex: 1, padding: "10px", borderRadius: "8px", border: accountTier === 'free' ? "2px solid #2563eb" : "1px solid #cbd5e1",
                                        background: accountTier === 'free' ? "#eff6ff" : "#ffffff", cursor: "pointer", fontWeight: 600, fontSize: "13px",
                                        color: accountTier === 'free' ? "#1e40af" : "#64748b"
                                    }}
                                >
                                    Free Tier (100 RPM / 1,000 RPD)
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { setAccountTier('paid'); setEmbeddingRpm(300); }}
                                    style={{
                                        flex: 1, padding: "10px", borderRadius: "8px", border: accountTier === 'paid' ? "2px solid #2563eb" : "1px solid #cbd5e1",
                                        background: accountTier === 'paid' ? "#eff6ff" : "#ffffff", cursor: "pointer", fontWeight: 600, fontSize: "13px",
                                        color: accountTier === 'paid' ? "#1e40af" : "#64748b"
                                    }}
                                >
                                    Pay-As-You-Go / Tier 1 (Up to 1,500 RPM)
                                </button>
                            </div>
                        </div>

                        {/* Rate Limiter Slider */}
                        <div style={{ marginBottom: "32px", background: "#f8fafc", padding: "16px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                                <span style={{ fontSize: "13px", fontWeight: 600, color: "#334155" }}>Pacing Rate Limit (RPM)</span>
                                <span style={{ fontSize: "14px", fontWeight: 700, color: "#2563eb" }}>{embeddingRpm} RPM</span>
                            </div>
                            <input
                                type="range"
                                min="10"
                                max={maxRpmLimit}
                                step="5"
                                value={embeddingRpm}
                                onChange={e => setEmbeddingRpm(Number(e.target.value))}
                                style={{ width: "100%", accentColor: "#2563eb", cursor: "pointer" }}
                            />
                            <p style={{ margin: "6px 0 0 0", fontSize: "11px", color: "#64748b" }}>
                                Safe headroom for Free Tier is <strong>70–80 RPM</strong> to prevent 429 quota exhaustion.
                            </p>
                        </div>

                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #f1f5f9", paddingTop: "20px" }}>
                            <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb", fontSize: "13px", fontWeight: 600, textDecoration: "underline" }}>
                                Get or check quota in Google AI Studio ↗
                            </a>
                            <button type="submit" style={{ padding: "10px 24px", borderRadius: "8px", border: "none", background: "#2563eb", color: "white", fontWeight: "bold", cursor: "pointer" }}>
                                Save Configuration
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}