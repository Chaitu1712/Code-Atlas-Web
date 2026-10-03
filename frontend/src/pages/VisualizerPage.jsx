import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import GraphVisualizer from '../GraphVisualizer';
import Sidebar from '../components/Sidebar';
import CodePanel from '../components/CodePanel';
import CyclesAlert from '../components/CyclesAlert'; 
import { apiFetch } from '../utils/apiClient';

export default function VisualizerPage() {
    const { projectName } = useParams();
    const [graphData, setGraphData] = useState(null);
    const [cycles, setCycles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [isSearching, setIsSearching] = useState(false);
    const [selectedNode, setSelectedNode] = useState(null);
    const [detailLevel, setDetailLevel] = useState(2);
    const [viewingCode, setViewingCode] = useState(null);
    const [isCodeLoading, setIsCodeLoading] = useState(false);

    useEffect(() => {
        const recents = JSON.parse(localStorage.getItem('codeAtlasRecents') || '[]');
        const newRecents = [projectName, ...recents.filter(p => p !== projectName)].slice(0, 3);
        localStorage.setItem('codeAtlasRecents', JSON.stringify(newRecents));

        setLoading(true);
        apiFetch(`/api/graph/${projectName}`)
            .then(res => res.json())
            .then(data => { 
                setGraphData(data.graph); 
                setCycles(data.cycles || []); 
                setLoading(false);  
            })
            .catch(() => setLoading(false));
    }, [projectName]);

    const handleSearch = async (e) => {
        e.preventDefault();
        if (!query.trim()) { 
            setQuery(''); setSearchResults([]); setSelectedNode(null); return; 
        }
        setIsSearching(true); 
        setSelectedNode(null); 
        setViewingCode(null);
        try {
            const res = await apiFetch(`/api/search/${projectName}?q=${encodeURIComponent(query)}`);
            const data = await res.json();
            setSearchResults(data.results || []);
        } finally { 
            setIsSearching(false); 
        }
    };

    const handleNodeClick = async (nodeId) => {
        setIsCodeLoading(true);
        try {
            const res = await apiFetch(`/api/node/${projectName}/${encodeURIComponent(nodeId)}`);
            setViewingCode(await res.json());
        } finally { 
            setIsCodeLoading(false); 
        }
    };

    return (
        <div style={{ margin: 0, padding: 0, height: "100vh", backgroundColor: "#f8fafc", position: "relative", fontFamily: "Inter, system-ui, sans-serif", overflow: "hidden" }}>
            <Sidebar 
                currentProject={projectName} detailLevel={detailLevel} setDetailLevel={setDetailLevel}
                query={query} setQuery={setQuery} handleSearch={handleSearch} isSearching={isSearching}
                searchResults={searchResults} selectedNode={selectedNode} setSelectedNode={setSelectedNode}
            />
            <CodePanel viewingCode={viewingCode} setViewingCode={setViewingCode} isCodeLoading={isCodeLoading} currentProject={projectName} />
            {cycles.length > 0 && <CyclesAlert cycles={cycles} />}
            {loading ? (
                <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%", color: "#64748b" }}>Loading architecture graph...</div>
            ) : (
                <GraphVisualizer graphData={graphData} searchResults={searchResults} selectedNode={selectedNode} detailLevel={detailLevel} onNodeClick={handleNodeClick} currentProject={projectName} />
            )}
        </div>
    );
}