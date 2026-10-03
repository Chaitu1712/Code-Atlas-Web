import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import GraphVisualizer from '../GraphVisualizer';
import Sidebar from '../components/Sidebar';
import CodePanel from '../components/CodePanel';
import CyclesAlert from '../components/CyclesAlert';
import GraphLegend from '../components/GraphLegend';
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
            handleClearSearch(); return;
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

    const handleClearSearch = () => {
        setQuery('');
        setSearchResults([]);
        setSelectedNode(null);
    };

    // Node click handler: Triggers BOTH the code slide-out AND neighbor highlights
    const handleNodeClick = async (nodeId) => {
        // Resolve fuzzy ID from graphData if available
        let resolvedId = nodeId;
        if (graphData?.nodes) {
            const match = graphData.nodes.find(n =>
                n.id === nodeId ||
                n.id.endsWith('.' + nodeId) ||
                n.id.split('.').pop() === nodeId
            );
            if (match) resolvedId = match.id;
        }

        setSelectedNode({ id: resolvedId });
        setIsCodeLoading(true);
        try {
            const res = await apiFetch(`/api/node/${projectName}/${encodeURIComponent(resolvedId)}`);
            setViewingCode(await res.json());
        } finally {
            setIsCodeLoading(false);
        }
    };

    // Clicking empty canvas resets focus
    const handleCanvasClick = () => {
        setSelectedNode(null);
        setViewingCode(null);
        if (!query) setSearchResults([]);
    };

    return (
        <div style={{ margin: 0, padding: 0, height: "100vh", backgroundColor: "#f8fafc", position: "relative", fontFamily: "Inter, system-ui, sans-serif", overflow: "hidden" }}>
            <Sidebar
                currentProject={projectName} detailLevel={detailLevel} setDetailLevel={setDetailLevel}
                query={query} setQuery={setQuery} handleSearch={handleSearch} isSearching={isSearching}
                searchResults={searchResults} selectedNode={selectedNode} setSelectedNode={setSelectedNode}
                onClearSearch={handleClearSearch}
            />
            <CodePanel
                viewingCode={viewingCode}
                setViewingCode={(val) => { setViewingCode(val); if (!val) setSelectedNode(null); }}
                isCodeLoading={isCodeLoading}
                currentProject={projectName}
                onNavigateNode={handleNodeClick}
            />
            {cycles.length > 0 && <CyclesAlert cycles={cycles} />}
            <GraphLegend />
            {loading ? (
                <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%", color: "#64748b" }}>Loading architecture graph...</div>
            ) : (
                // In VisualizerPage.jsx:
                <GraphVisualizer
                    graphData={graphData}
                    searchResults={searchResults}
                    selectedNode={selectedNode}
                    detailLevel={detailLevel}
                    onNodeClick={handleNodeClick}
                    onCanvasClick={handleCanvasClick}
                    currentProject={projectName}
                    isPanelOpen={Boolean(viewingCode)}
                />
            )}
        </div>
    );
}