import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { apiFetch } from './utils/apiClient';

export default function GraphVisualizer({ 
    graphData, searchResults, selectedNode, detailLevel, 
    onNodeClick, onCanvasClick, currentProject, isPanelOpen 
}) {
    const svgRef = useRef();
    const gRef = useRef();
    const simulationRef = useRef();
    const minimapNodesRef = useRef();
    const zoomRef = useRef();

    const nodesRef = useRef();
    const linksRef = useRef();
    const labelsRef = useRef();

    const minimapScale = 0.04; 
    const minimapSize = 160;

    const handleZoomIn = () => {
        if (svgRef.current && zoomRef.current) {
            d3.select(svgRef.current).transition().duration(300).call(zoomRef.current.scaleBy, 1.3);
        }
    };

    const handleZoomOut = () => {
        if (svgRef.current && zoomRef.current) {
            d3.select(svgRef.current).transition().duration(300).call(zoomRef.current.scaleBy, 0.7);
        }
    };

    const handleResetView = () => {
        if (svgRef.current && zoomRef.current) {
            const width = window.innerWidth;
            const height = window.innerHeight;
            d3.select(svgRef.current).transition().duration(500)
                .call(zoomRef.current.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(1));
        }
    };

    // --- 1. SIMULATION & RENDER ---
    useEffect(() => {
        if (!graphData || !graphData.nodes || !graphData.nodes.length) return;

        let filteredNodes = graphData.nodes.filter(n => {
            if (detailLevel === 1) return n.type === 'module_internal' || n.type === 'module_external' || n.type === 'package';
            if (detailLevel === 2) return n.type !== 'function';
            return true;
        });

        const nodeIds = new Set(filteredNodes.map(n => n.id));
        const allLinks = graphData.edges || graphData.links || [];
        let filteredLinks = allLinks.filter(l => nodeIds.has(l.source.id || l.source) && nodeIds.has(l.target.id || l.target));

        const width = window.innerWidth;
        const height = window.innerHeight;

        d3.select(svgRef.current).selectAll("*").remove();
        const svg = d3.select(svgRef.current).attr("width", width).attr("height", height);

        const defs = svg.append("defs");
        const pattern = defs.append("pattern").attr("id", "dots").attr("x", 0).attr("y", 0).attr("width", 24).attr("height", 24).attr("patternUnits", "userSpaceOnUse");
        pattern.append("circle").attr("cx", 2).attr("cy", 2).attr("r", 1).attr("fill", "rgba(0,0,0,0.06)");
        
        svg.append("rect")
            .attr("width", "100%").attr("height", "100%")
            .attr("fill", "url(#dots)")
            .style("cursor", "grab")
            .on("click", (e) => {
                if (e.target.tagName === 'rect' && onCanvasClick) onCanvasClick();
            });

        const filter = defs.append("filter").attr("id", "shadow").attr("x", "-20%").attr("y", "-20%").attr("width", "140%").attr("height", "140%");
        filter.append("feDropShadow").attr("dx", "0").attr("dy", "2").attr("stdDeviation", "2").attr("flood-opacity", "0.12");

        gRef.current = svg.append("g");

        // Minimap setup
        const minimapOffset = isPanelOpen ? 524 : 24;
        const minimapContainer = svg.append("g")
            .attr("transform", `translate(${width - minimapSize - minimapOffset}, ${height - minimapSize - 24})`)
            .style("transition", "transform 0.3s ease");
        
        minimapContainer.append("rect")
            .attr("width", minimapSize).attr("height", minimapSize)
            .attr("fill", "rgba(255,255,255,0.85)")
            .attr("stroke", "rgba(0,0,0,0.1)").attr("rx", 12)
            .style("backdrop-filter", "blur(8px)");

        const minimapContent = minimapContainer.append("g");
        const minimapViewport = minimapContainer.append("rect")
            .attr("fill", "rgba(37, 99, 235, 0.1)")
            .attr("stroke", "#2563eb").attr("stroke-width", 1.5)
            .attr("rx", 4);

        const zoom = d3.zoom().scaleExtent([0.1, 4]).on("zoom", (event) => {
            gRef.current.attr("transform", event.transform);
            const t = event.transform;
            minimapViewport
                .attr("x", (minimapSize / 2) + (-t.x / t.k) * minimapScale)
                .attr("y", (minimapSize / 2) + (-t.y / t.k) * minimapScale)
                .attr("width", (width / t.k) * minimapScale)
                .attr("height", (height / t.k) * minimapScale);

            // LOD (Level of Detail): Reveal function labels dynamically when zoomed in
            if (labelsRef.current) {
                const isZoomedIn = t.k >= 1.25;
                labelsRef.current.style("display", d => {
                    if (d.type !== 'function') return "block";
                    return (isZoomedIn || selectedNode) ? "block" : "none";
                });
            }
        });
        zoomRef.current = zoom;
        svg.call(zoom).on("dblclick.zoom", null);

        // Arrow markers
        const edgeColors = { contains: '#94a3b8', import: '#64748b', call_internal: '#ec4899', call_external: '#f97316', default: '#94a3b8', api_call: '#06b6d4'};
        Object.keys(edgeColors).forEach(type => {
            defs.append("marker").attr("id", `arrow-${type}`).attr("viewBox", "-0 -5 10 10").attr("refX", 18).attr("refY", 0).attr("orient", "auto").attr("markerWidth", 4).attr("markerHeight", 4).append("svg:path").attr("d", "M 0,-5 L 10 ,0 L 0,5").attr("fill", edgeColors[type]);
        });

        filteredNodes.forEach(n => {
            if (n.x === undefined || n.y === undefined) {
                n.x = width / 2 + (Math.random() - 0.5) * 80;
                n.y = height / 2 + (Math.random() - 0.5) * 80;
            }
        });

        // --- ENHANCED FORCE PHYSICS (DECLUTTERING ENGINE) ---
        const simulation = d3.forceSimulation(filteredNodes)
            .alphaDecay(0.04)
            .force("link", d3.forceLink(filteredLinks).id(d => d.id).distance(d => {
                if (d.type === 'contains') return 45;
                if (d.type === 'import') return 75;
                if (d.type === 'api_call') return 140;
                return 110; // Give call lines space to breathe
            }))
            .force("charge", d3.forceManyBody().strength(d => d.type === 'package' ? -450 : (d.type === 'module_internal' ? -260 : -140)))
            .force("center", d3.forceCenter(width / 2, height / 2))
            .force("collide", d3.forceCollide().radius(d => (d.type === 'package' ? 38 : d.type === 'module_internal' ? 28 : 20)).strength(0.9));

        simulationRef.current = simulation;

        // Links: Subtle ghost opacity by default to stop spaghetti soup
        linksRef.current = gRef.current.append("g").selectAll("path").data(filteredLinks).join("path")
            .attr("fill", "none")
            .attr("stroke", d => edgeColors[d.type] || edgeColors.default)
            .attr("stroke-opacity", d => {
                if (d.type === 'api_call') return 0.8;
                if (d.type === 'contains') return 0.4;
                if (d.type === 'import') return 0.35;
                return 0.12; // Internal & External calls ghosted until inspected!
            })
            .attr("stroke-width", d => d.type === 'api_call' ? 2.5 : (d.type === 'contains' ? 1 : 1.2))
            .attr("stroke-dasharray", d => d.type === 'contains' ? "3,3" : (d.type === 'api_call' ? "8,4" : "none"))
            .attr("marker-end", d => `url(#arrow-${d.type || 'default'})`);

        const colorScale = (type) => {
            if (type === 'module_internal') return '#10b981'; 
            if (type === 'module_external') return '#64748b'; 
            if (type === 'package') return '#3b82f6'; 
            if (type === 'class') return '#a855f7'; 
            if (type === 'function') return '#f59e0b'; 
            return '#fff';
        };

        const drag = (sim) => d3.drag()
            .on("start", event => { event.subject.fx = event.subject.x; event.subject.fy = event.subject.y; })
            .on("drag", event => { if (sim.alpha() < 0.1) sim.alpha(0.1).restart(); event.subject.fx = event.x; event.subject.fy = event.y; })
            .on("end", event => {
                if (currentProject) {
                    apiFetch(`/api/graph/${currentProject}/layout`, {
                        method: 'POST',
                        body: JSON.stringify([{ node_id: event.subject.id, fx: event.subject.fx, fy: event.subject.fy }])
                    });
                }
            });

        nodesRef.current = gRef.current.append("g").selectAll("circle").data(filteredNodes).join("circle")
            .attr("r", d => d.type === 'package' ? 14 : d.type === 'module_internal' ? 10 : d.type === 'class' ? 8 : 4.5)
            .attr("fill", d => colorScale(d.type))
            .attr("stroke", "#ffffff").attr("stroke-width", 2)
            .style("filter", "url(#shadow)") 
            .style("cursor", "pointer")
            .call(drag(simulation))
            .on('dblclick', (event, d) => {
                delete d.fx; delete d.fy; simulation.alpha(0.3).restart();
                if (currentProject) {
                    apiFetch(`/api/graph/${currentProject}/layout`, {
                        method: 'POST',
                        body: JSON.stringify([{ node_id: d.id, fx: null, fy: null }])
                    });
                }
            })
            .on('click', (event, d) => {
                event.stopPropagation();
                if (onNodeClick) onNodeClick(d.id);
            });

        // Labels with crisp halo
        labelsRef.current = gRef.current.append("g").selectAll("text").data(filteredNodes).join("text")
            .attr("dy", d => d.type === 'function' ? -9 : -14)
            .attr("text-anchor", "middle")
            .text(d => d.id.split('.').pop())
            .attr("font-size", d => d.type === 'function' ? "9px" : (d.type === 'package' ? "12px" : "11px"))
            .attr("font-weight", d => d.type === 'package' ? "700" : "600")
            .attr("fill", "#0f172a")
            .attr("paint-order", "stroke")
            .attr("stroke", "#ffffff").attr("stroke-width", 3)
            .attr("stroke-linejoin", "round")
            .attr("pointer-events", "none")
            .style("display", d => d.type === 'function' ? "none" : "block"); // Hide function labels globally by default!

        minimapNodesRef.current = minimapContent.selectAll("circle").data(filteredNodes).join("circle")
            .attr("r", 1.5).attr("fill", d => colorScale(d.type));

        simulation.on("tick", () => {
            linksRef.current.attr("d", d => {
                if (d.source.id === d.target.id) { 
                    const x = d.source.x, y = d.source.y; 
                    return `M ${x},${y} C ${x+35},${y-35} ${x+35},${y+35} ${x},${y}`;
                }
                if (d.type === 'contains') return `M${d.source.x},${d.source.y} L${d.target.x},${d.target.y}`;
                const dx = d.target.x - d.source.x, dy = d.target.y - d.source.y, dr = Math.sqrt(dx * dx + dy * dy);
                return `M${d.source.x},${d.source.y}A${dr},${dr} 0 0,1 ${d.target.x},${d.target.y}`;
            });
            nodesRef.current.attr("cx", d => d.x).attr("cy", d => d.y);
            labelsRef.current.attr("x", d => d.x).attr("y", d => d.y);
        });

        simulation.on("end", () => {
            if (minimapNodesRef.current) {
                minimapNodesRef.current
                    .attr("cx", d => (minimapSize / 2) + d.x * minimapScale)
                    .attr("cy", d => (minimapSize / 2) + d.y * minimapScale);
            }
        });

        svg.call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2));
        return () => simulation.stop();
    }, [graphData, detailLevel]);

    // --- 2. FUZZY NODE RESOLVER & ACTIVE HIGHLIGHTING ---
    useEffect(() => {
        if (!nodesRef.current || !linksRef.current || !labelsRef.current) return;

        const hasSearch = searchResults && searchResults.length > 0;
        const matchedIds = new Set(hasSearch ? searchResults.map(r => r.id) : []);

        // A. NODE SELECTED (From Search Result OR Canvas Click OR Navigator Pill)
        if (selectedNode) {
            const rawId = selectedNode.id;

            // FUZZY RESOLVER: Matches "main" -> "cli.main", or "EmbeddingService" -> "core.embeddings.EmbeddingService"
            let targetData = nodesRef.current.data().find(d => d.id === rawId);
            if (!targetData) {
                targetData = nodesRef.current.data().find(d => 
                    d.id.endsWith('.' + rawId) || 
                    d.id.split('.').pop() === rawId ||
                    d.name === rawId
                );
            }

            if (targetData) {
                const targetId = targetData.id;

                // Discover 1-hop callers, callees, and parent
                const neighborIds = new Set();
                neighborIds.add(targetId);

                linksRef.current.data().forEach(l => {
                    const sId = l.source.id || l.source;
                    const tId = l.target.id || l.target;
                    if (sId === targetId) neighborIds.add(tId);
                    if (tId === targetId) neighborIds.add(sId);
                });

                if (targetData.parent) neighborIds.add(targetData.parent);

                // Highlight Nodes
                nodesRef.current
                    .transition().duration(250)
                    .style('opacity', d => neighborIds.has(d.id) ? 1 : 0.08)
                    .attr('stroke', d => d.id === targetId ? '#2563eb' : (neighborIds.has(d.id) ? '#38bdf8' : '#ffffff'))
                    .attr('stroke-width', d => d.id === targetId ? 3.5 : (neighborIds.has(d.id) ? 2.5 : 1.5));

                // Connected Edges: Light up in vibrant color!
                linksRef.current
                    .transition().duration(250)
                    .style('opacity', l => {
                        const sId = l.source.id || l.source;
                        const tId = l.target.id || l.target;
                        return (sId === targetId || tId === targetId) ? 1 : 0.02;
                    })
                    .attr('stroke-width', l => {
                        const sId = l.source.id || l.source;
                        const tId = l.target.id || l.target;
                        return (sId === targetId || tId === targetId) ? (l.type === 'api_call' ? 4 : 2.5) : 1;
                    });

                // Force display labels for the target & neighbors
                labelsRef.current
                    .transition().duration(250)
                    .style('display', d => neighborIds.has(d.id) ? "block" : "none")
                    .style('opacity', d => neighborIds.has(d.id) ? 1 : 0.08);

                // Smooth Camera Glide right onto the target node
                if (zoomRef.current && svgRef.current) {
                    const scale = 1.35;
                    const x = (window.innerWidth / 2) - (targetData.x * scale);
                    const y = (window.innerHeight / 2) - (targetData.y * scale);
                    
                    d3.select(svgRef.current)
                        .transition().duration(600).ease(d3.easeCubicOut)
                        .call(zoomRef.current.transform, d3.zoomIdentity.translate(x, y).scale(scale));
                }
            }
        } 
        // B. SEARCH RESULTS MATCHING
        else if (hasSearch) {
            nodesRef.current
                .transition().duration(200)
                .style('opacity', d => matchedIds.has(d.id) ? 1 : 0.1)
                .attr('stroke', d => matchedIds.has(d.id) ? '#2563eb' : '#ffffff')
                .attr('stroke-width', d => matchedIds.has(d.id) ? 3 : 2);

            linksRef.current.transition().duration(200).style('opacity', 0.03);
            labelsRef.current
                .transition().duration(200)
                .style('display', d => matchedIds.has(d.id) ? "block" : (d.type === 'function' ? "none" : "block"))
                .style('opacity', d => matchedIds.has(d.id) ? 1 : 0.1);
        } 
        // C. DEFAULT RESTING STATE
        else {
            nodesRef.current
                .transition().duration(250)
                .style('opacity', 1)
                .attr('stroke', '#ffffff')
                .attr('stroke-width', 2);

            linksRef.current
                .transition().duration(250)
                .style('opacity', d => {
                    if (d.type === 'api_call') return 0.8;
                    if (d.type === 'contains') return 0.4;
                    if (d.type === 'import') return 0.35;
                    return 0.12;
                })
                .attr('stroke-width', d => d.type === 'api_call' ? 2.5 : (d.type === 'contains' ? 1 : 1.2));

            labelsRef.current
                .transition().duration(250)
                .style('display', d => d.type === 'function' ? "none" : "block")
                .style('opacity', 1);
        }
    }, [selectedNode, searchResults]);

    return (
        <div style={{ position: "relative", width: "100%", height: "100vh", overflow: "hidden" }}>
            <svg ref={svgRef} style={{ background: "#f8fafc", width: "100%", height: "100%", display: "block" }} />

            {/* Floating Navigation Deck */}
            <div style={{
                position: "absolute", 
                bottom: minimapSize + 36, 
                right: isPanelOpen ? 524 : 24, 
                zIndex: 10,
                display: "flex", flexDirection: "column", gap: "6px",
                background: "rgba(255, 255, 255, 0.9)", backdropFilter: "blur(12px)",
                padding: "6px", borderRadius: "10px", border: "1px solid rgba(0,0,0,0.08)",
                boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
                transition: "right 0.3s cubic-bezier(0.16, 1, 0.3, 1)"
            }}>
                <button onClick={handleZoomIn} title="Zoom In" style={{ width: "32px", height: "32px", border: "none", background: "transparent", borderRadius: "6px", cursor: "pointer", fontSize: "16px", fontWeight: "bold", color: "#334155" }}>+</button>
                <button onClick={handleZoomOut} title="Zoom Out" style={{ width: "32px", height: "32px", border: "none", background: "transparent", borderRadius: "6px", cursor: "pointer", fontSize: "16px", fontWeight: "bold", color: "#334155" }}>−</button>
                <button onClick={handleResetView} title="Center Graph" style={{ width: "32px", height: "32px", border: "none", background: "transparent", borderRadius: "6px", cursor: "pointer", fontSize: "13px", color: "#334155" }}>🎯</button>
            </div>
        </div>
    );
}