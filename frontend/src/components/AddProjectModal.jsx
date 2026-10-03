import React, { useState, useEffect } from 'react';
import { apiFetch, getProgressWsUrl } from '../utils/apiClient';
import { IconClose } from './Icons';

export default function AddProjectModal({ onClose, onSuccess }) {
    const [tab, setTab] = useState('github'); // 'github' | 'zip'
    const [githubUrl, setGithubUrl] = useState('');
    const [zipFile, setZipFile] = useState(null);
    const [projectName, setProjectName] = useState('');
    
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [progressStatus, setProgressStatus] = useState('');
    const [progressMessage, setProgressMessage] = useState('');
    const [progressPercent, setProgressPercent] = useState(0);

    // WebSocket listener for isolated progress events
    useEffect(() => {
        const ws = new WebSocket(getProgressWsUrl());
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.status) setProgressStatus(data.status);
                if (data.message) setProgressMessage(data.message);
                if (typeof data.percent === 'number') setProgressPercent(data.percent);
            } catch (e) {}
        };
        return () => ws.close();
    }, []);

    // Trigger redirect when extraction hits 100%
    useEffect(() => {
        if (progressPercent === 100 && projectName) {
            const timer = setTimeout(() => {
                onSuccess(projectName);
            }, 600);
            return () => clearTimeout(timer);
        }
    }, [progressPercent, projectName, onSuccess]);

    const handleGithubSubmit = async (e) => {
        e.preventDefault();
        setIsLoading(true);
        setError('');
        setProgressPercent(0);

        const cleanUrl = githubUrl.trim().replace(/\/$/, '');
        const derivedName = cleanUrl.split('/').pop().replace('.git', '');
        setProjectName(derivedName);

        try {
            const res = await apiFetch('/api/projects/github', {
                method: 'POST',
                body: JSON.stringify({ github_url: cleanUrl, project_name: derivedName })
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || 'Failed to start GitHub ingestion');
            }
        } catch (err) {
            setError(err.message);
            setIsLoading(false);
        }
    };

    const handleZipSubmit = async (e) => {
        e.preventDefault();
        if (!zipFile) {
            setError('Please select a .zip archive of your project.');
            return;
        }

        setIsLoading(true);
        setError('');
        setProgressPercent(0);

        const cleanName = (projectName || zipFile.name.replace(/\.[^/.]+$/, '')).trim();
        setProjectName(cleanName);

        const formData = new FormData();
        formData.append('file', zipFile);
        formData.append('project_name', cleanName);

        try {
            const res = await apiFetch('/api/projects/upload-zip', {
                method: 'POST',
                body: formData
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || 'Failed to upload project ZIP');
            }
        } catch (err) {
            setError(err.message);
            setIsLoading(false);
        }
    };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100,
            background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(4px)',
            display: 'flex', justifyContent: 'center', alignItems: 'center'
        }}>
            <div style={{
                background: '#fff', padding: '30px', borderRadius: '16px',
                width: '460px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', fontFamily: 'Inter, sans-serif'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <h2 style={{ margin: 0, color: '#0f172a', fontSize: '20px' }}>Parse Codebase</h2>
                    {!isLoading && (
                        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
                            <IconClose size={20} />
                        </button>
                    )}
                </div>

                {error && (
                    <div style={{ color: '#e11d48', background: '#fff1f2', padding: '10px', borderRadius: '8px', marginBottom: '15px', fontSize: '13px' }}>
                        {error}
                    </div>
                )}

                {!isLoading ? (
                    <>
                        {/* Tab Switcher */}
                        <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: '8px', padding: '4px', marginBottom: '20px' }}>
                            <button
                                type="button"
                                onClick={() => setTab('github')}
                                style={{
                                    flex: 1, padding: '8px', border: 'none', borderRadius: '6px', cursor: 'pointer',
                                    fontWeight: 600, fontSize: '13px',
                                    background: tab === 'github' ? '#fff' : 'transparent',
                                    color: tab === 'github' ? '#2563eb' : '#64748b',
                                    boxShadow: tab === 'github' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                                }}
                            >
                                🐙 GitHub URL
                            </button>
                            <button
                                type="button"
                                onClick={() => setTab('zip')}
                                style={{
                                    flex: 1, padding: '8px', border: 'none', borderRadius: '6px', cursor: 'pointer',
                                    fontWeight: 600, fontSize: '13px',
                                    background: tab === 'zip' ? '#fff' : 'transparent',
                                    color: tab === 'zip' ? '#2563eb' : '#64748b',
                                    boxShadow: tab === 'zip' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                                }}
                            >
                                📦 Upload .ZIP
                            </button>
                        </div>

                        {tab === 'github' ? (
                            <form onSubmit={handleGithubSubmit}>
                                <label style={{ display: 'block', marginBottom: '20px', fontSize: '13px', color: '#64748b', fontWeight: 600 }}>
                                    Public Repository URL
                                    <input
                                        required
                                        type="url"
                                        value={githubUrl}
                                        onChange={e => setGithubUrl(e.target.value)}
                                        placeholder="https://github.com/facebook/react"
                                        style={{ width: '100%', padding: '10px', marginTop: '6px', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', boxSizing: 'border-box' }}
                                    />
                                </label>
                                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                                    <button type="button" onClick={onClose} style={{ padding: '10px 16px', borderRadius: '8px', border: 'none', background: '#f1f5f9', color: '#64748b', cursor: 'pointer', fontWeight: 600 }}>Cancel</button>
                                    <button type="submit" style={{ padding: '10px 16px', borderRadius: '8px', border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Download & Parse</button>
                                </div>
                            </form>
                        ) : (
                            <form onSubmit={handleZipSubmit}>
                                <label style={{ display: 'block', marginBottom: '14px', fontSize: '13px', color: '#64748b', fontWeight: 600 }}>
                                    Project Name
                                    <input
                                        type="text"
                                        value={projectName}
                                        onChange={e => setProjectName(e.target.value)}
                                        placeholder="my-cool-project"
                                        style={{ width: '100%', padding: '10px', marginTop: '6px', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', boxSizing: 'border-box' }}
                                    />
                                </label>
                                <label style={{ display: 'block', marginBottom: '20px', fontSize: '13px', color: '#64748b', fontWeight: 600 }}>
                                    Select .zip archive of codebase
                                    <input
                                        required
                                        type="file"
                                        accept=".zip"
                                        onChange={e => setZipFile(e.target.files[0])}
                                        style={{ width: '100%', padding: '8px', marginTop: '6px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                                    />
                                </label>
                                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                                    <button type="button" onClick={onClose} style={{ padding: '10px 16px', borderRadius: '8px', border: 'none', background: '#f1f5f9', color: '#64748b', cursor: 'pointer', fontWeight: 600 }}>Cancel</button>
                                    <button type="submit" style={{ padding: '10px 16px', borderRadius: '8px', border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Upload & Parse</button>
                                </div>
                            </form>
                        )}
                    </>
                ) : (
                    <div style={{ textAlign: 'center', padding: '24px 0' }}>
                        <div style={{ fontSize: '15px', fontWeight: 600, color: '#0f172a', marginBottom: '6px' }}>
                            {progressStatus || 'Processing...'}
                        </div>
                        <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '20px', height: '18px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {progressMessage}
                        </div>
                        <div style={{ width: '100%', background: '#f1f5f9', borderRadius: '8px', height: '8px', overflow: 'hidden' }}>
                            <div style={{ width: `${progressPercent}%`, height: '100%', background: '#2563eb', transition: 'width 0.25s ease-out' }} />
                        </div>
                        <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '8px', fontWeight: 'bold' }}>
                            {progressPercent}%
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}