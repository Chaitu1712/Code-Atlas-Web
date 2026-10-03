import React, { useState } from 'react';
import { getGeminiKey, setGeminiKey, apiFetch } from '../utils/apiClient';
import { IconClose } from './Icons';

export default function GeminiKeyModal({ isOpen, onClose, onSaved }) {
    const [key, setKey] = useState(getGeminiKey());
    const [saving, setSaving] = useState(false);

    if (!isOpen) return null;

    const handleSave = async (e) => {
        e.preventDefault();
        setSaving(true);
        setGeminiKey(key);

        // Sync with backend configuration
        try {
            await apiFetch('/api/config', {
                method: 'POST',
                body: JSON.stringify({ gemini_api_key: key.trim() })
            });
        } catch (err) {
            console.error("Config sync error:", err);
        }

        setSaving(false);
        if (onSaved) onSaved(key);
        onClose();
    };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(6px)',
            display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999
        }}>
            <div style={{
                background: '#ffffff', borderRadius: '16px', padding: '32px',
                width: '520px', maxWidth: '90%', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                fontFamily: 'Inter, sans-serif'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '24px' }}>✨</span>
                        <h2 style={{ margin: 0, fontSize: '20px', color: '#0f172a', fontWeight: 700 }}>
                            Connect Google Gemini
                        </h2>
                    </div>
                    <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
                        <IconClose size={20} />
                    </button>
                </div>

                <p style={{ color: '#475569', fontSize: '14px', lineHeight: '1.5', margin: '0 0 20px 0' }}>
                    Code Atlas uses Gemini for semantic vector search and architecture Q&A. The API is free through Google AI Studio.
                </p>

                {/* Instructions */}
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px', marginBottom: '20px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>
                        How to get your free key:
                    </div>
                    <ol style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: '#64748b', lineHeight: '1.7' }}>
                        <li>
                            Visit <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', fontWeight: 600, textDecoration: 'underline' }}>Google AI Studio</a>.
                        </li>
                        <li>Sign in with any Google account.</li>
                        <li>Click <strong>"Create API key"</strong> and copy it.</li>
                    </ol>
                </div>

                <form onSubmit={handleSave}>
                    <label style={{ display: 'block', marginBottom: '20px' }}>
                        <span style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#0f172a', marginBottom: '8px' }}>
                            Gemini API Key
                        </span>
                        <input
                            type="password"
                            required
                            placeholder="AIzaSy..."
                            value={key}
                            onChange={(e) => setKey(e.target.value)}
                            style={{
                                width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1',
                                fontSize: '14px', outline: 'none', boxSizing: 'border-box'
                            }}
                        />
                    </label>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                        <button
                            type="button"
                            onClick={onClose}
                            style={{
                                padding: '10px 16px', borderRadius: '8px', border: '1px solid #cbd5e1',
                                background: 'transparent', color: '#64748b', cursor: 'pointer', fontWeight: 600, fontSize: '13px'
                            }}
                        >
                            Skip for now
                        </button>
                        <button
                            type="submit"
                            disabled={saving || !key.trim()}
                            style={{
                                padding: '10px 20px', borderRadius: '8px', border: 'none',
                                background: '#2563eb', color: '#ffffff', cursor: saving ? 'wait' : 'pointer',
                                fontWeight: 600, fontSize: '13px'
                            }}
                        >
                            {saving ? 'Saving...' : 'Save & Enable AI'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}