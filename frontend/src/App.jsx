import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import AllProjectsPage from './pages/AllProjectsPage';
import VisualizerPage from './pages/VisualizerPage';
import SettingsPage from './pages/SettingsPage';
import GeminiKeyModal from './components/GeminiKeyModal';
import { getGeminiKey, apiFetch } from './utils/apiClient';

function App() {
  const [hasGeminiKey, setHasGeminiKey] = useState(Boolean(getGeminiKey()));
  const [showKeyModal, setShowKeyModal] = useState(false);

  useEffect(() => {
    // If not in localStorage, check backend config once
    if (!hasGeminiKey) {
      apiFetch('/api/config')
        .then(res => res.json())
        .then(data => {
          if (data.config?.gemini_api_key) {
            localStorage.setItem('code_atlas_gemini_key', data.config.gemini_api_key);
            setHasGeminiKey(true);
          }
        })
        .catch(() => {});
    }
  }, [hasGeminiKey]);

  return (
    <Router>
      {!hasGeminiKey && (
        <div style={{
          background: '#eff6ff', borderBottom: '1px solid #bfdbfe', padding: '10px 24px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', color: '#1e40af'
        }}>
          <div>
            ✨ <strong>AI features are idle:</strong> Connect your free Gemini API key to activate semantic architecture search and node chat.
          </div>
          <button
            onClick={() => setShowKeyModal(true)}
            style={{
              background: '#2563eb', color: '#fff', border: 'none', padding: '6px 12px',
              borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '12px'
            }}
          >
            Connect Key
          </button>
        </div>
      )}

      <GeminiKeyModal 
        isOpen={showKeyModal} 
        onClose={() => setShowKeyModal(false)}
        onSaved={() => setHasGeminiKey(true)}
      />

      <Routes>
        <Route path="/" element={<LandingPage onOpenKeyModal={() => setShowKeyModal(true)} />} />
        <Route path="/projects" element={<AllProjectsPage />} />
        <Route path="/visualize/:projectName" element={<VisualizerPage onOpenKeyModal={() => setShowKeyModal(true)} />} />
        <Route path="/settings" element={<SettingsPage onKeyUpdated={() => setHasGeminiKey(true)} />} />
      </Routes>
    </Router>
  );
}

export default App;