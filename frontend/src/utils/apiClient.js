const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// 1. Get or create persistent device fingerprint (UUID)
export function getClientId() {
    let id = localStorage.getItem('code_atlas_client_id');
    if (!id) {
        id = typeof crypto.randomUUID === 'function' 
            ? crypto.randomUUID() 
            : 'client_' + Math.random().toString(36).substring(2, 15);
        localStorage.setItem('code_atlas_client_id', id);
    }
    return id;
}

// 2. Client-side Gemini API key getter/setter
export function getGeminiKey() {
    return localStorage.getItem('code_atlas_gemini_key') || '';
}

export function setGeminiKey(key) {
    if (!key) {
        localStorage.removeItem('code_atlas_gemini_key');
    } else {
        localStorage.setItem('code_atlas_gemini_key', key.trim());
    }
}

// 3. Authenticated/Identified Fetch Wrapper
export async function apiFetch(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
    const headers = {
        'X-User-ID': getClientId(),
        'X-Gemini-Key': getGeminiKey(),
        ...(options.headers || {})
    };

    // Don't override Content-Type if uploading FormData (let browser set boundary)
    if (!(options.body instanceof FormData) && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }

    return fetch(url, { ...options, headers });
}

// 4. WebSocket URL generator
export function getProgressWsUrl() {
    const wsBase = API_BASE.replace(/^http/, 'ws');
    return `${wsBase}/ws/progress?client_id=${getClientId()}`;
}

export { API_BASE };