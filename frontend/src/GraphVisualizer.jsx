import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { apiFetch } from './utils/apiClient';

export default function GraphVisualizer({ graphData, searchResults, selectedNode, detailLevel, onNodeClick, currentProject }) {
    const svgRef = useRef();
    const gRef = useRef();
    const simulationRef = useRef();
    const minimapNodesRef = useRef();
    const zoomRef = useRef();

    const minimapScale = 0.04; 

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
        const pattern = defs.append("pattern").attr("id", "dots").attr("x", 0).attr("y", 0).attr("width", 20).attr("height", 20).attr("patternUnits", "userSpaceOnUse");
        pattern.append("circle").attr("cx", 2).attr("cy", 2).attr("r", 1).attr("fill", "rgba(0,0,0,0.06)");
        svg.append("rect").attr("width", "100%").attr("height", "100%").attr("fill", "url(#dots)");

        const filter = defs.append("filter").attr("id", "shadow").attr("x", "-20%").attr("y", "-20%").attr("width", "140%").attr("height", "140%");
        filter.append("feDropShadow").attr("dx", "0").attr("dy", "2").attr("stdDeviation", "2").attr("flood-opacity", "0.15");

        gRef.current = svg.append("g");

        // Minimap Structure
        const minimapSize = 160;
        const minimapOffset = 24;
        const minimapContainer = svg.append("g")
            .attr("transform", `translate(${width - minimapSize - minimapOffset}, ${height - minimapSize - minimapOffset})`);
        
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
        });
        zoomRef.current = zoom;
        svg.call(zoom).on("dblclick.zoom", null);

        const edgeColors = { contains: '#8e9092', import: '#94a3b8', call_internal: '#ec4899', call_external: '#f97316', default: '#94a3b8', api_call: '#06b6d4'};
        Object.keys(edgeColors).forEach(type => {
            defs.append("marker").attr("id", `arrow-${type}`).attr("viewBox", "-0 -5 10 10").attr("refX", 20).attr("refY", 0).attr("orient", "auto").attr("markerWidth", 5).attr("markerHeight", 5).append("svg:path").attr("d", "M 0,-5 L 10 ,0 L 0,5").attr("fill", edgeColors[type]);
        });

        filteredNodes.forEach(n => {
            if (n.x === undefined || n.y === undefined) {
                n.x = width / 2 + (Math.random() - 0.5) * 50;
                n.y = height / 2 + (Math.random() - 0.5) * 50;
            }
        });

        const simulation = d3.forceSimulation(filteredNodes)
            .alphaDecay(0.06)
            .force("link", d3.forceLink(filteredLinks).id(d => d.id).distance(d => d.type === 'contains' ? 40 : 50))
            .force("charge", d3.forceManyBody().strength(detailLevel === 3 ? -80 : -150))
            .force("center", d3.forceCenter(width / 2, height / 2))
            .force("collide", d3.forceCollide().radius(detailLevel === 1 ? 40 : 20));

        const links = gRef.current.append("g").selectAll("path").data(filteredLinks).join("path")
            .attr("fill", "none")
            .attr("stroke", d => edgeColors[d.type] || edgeColors.default)
            .attr("stroke-opacity", d => (d.type === 'contains' || d.type === 'api_call') ? 0.6 : 0.8)
            .attr("stroke-width", d => d.type === 'api_call' ? 3 : (d.type === 'contains' ? 1 : 1.5))
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

        const nodes = gRef.current.append("g").selectAll("circle").data(filteredNodes).join("circle")
            .attr("r", d => d.type === 'package' || d.type === 'module_internal' ? 12 : d.type === 'class' ? 8 : 5)
            .attr("fill", d => colorScale(d.type)).attr("stroke", "#ffffff").attr("stroke-width", 2).style("filter", "url(#shadow)") 
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
                if (event.defaultPrevented) return;
                if (onNodeClick) onNodeClick(d.id);
            });

        const labels = gRef.current.append("g").selectAll("text").data(filteredNodes).join("text")
            .attr("dy", d => d.type === 'function' ? -10 : -14)
            .attr("text-anchor", "middle")
            .text(d => d.id.split('.').pop())
            .attr("font-size", d => d.type === 'function' ? "9px" : "11px")
            .attr("font-weight", d => d.type === 'package' ? "bold" : "600")
            .attr("fill", "#0f172a").attr("paint-order", "stroke").attr("stroke", "#ffffff").attr("stroke-width", 3).attr("pointer-events", "none");

        // Minimap Nodes (Decoupled from simulation tick)
        minimapNodesRef.current = minimapContent.selectAll("circle").data(filteredNodes).join("circle")
            .attr("r", 1.5).attr("fill", d => colorScale(d.type));

        simulation.on("tick", () => {
            links.attr("d", d => {
                if (d.source.id === d.target.id) { 
                    const x = d.source.x, y = d.source.y; 
                    return `M ${x},${y} C ${x+40},${y-40} ${x+40},${y+40} ${x},${y}`;
                }
                if (d.type === 'contains') return `M${d.source.x},${d.source.y} L${d.target.x},${d.target.y}`;
                const dx = d.target.x - d.source.x, dy = d.target.y - d.source.y, dr = Math.sqrt(dx * dx + dy * dy);
                return `M${d.source.x},${d.source.y}A${dr},${dr} 0 0,1 ${d.target.x},${d.target.y}`;
            });
            nodes.attr("cx", d => d.x).attr("cy", d => d.y);
            labels.attr("x", d => d.x).attr("y", d => d.y);
        });

        // Update minimap positions once simulation cools down
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

    return (
        <div style={{ position: "relative", width: "100%", height: "100vh" }}>
            <svg ref={svgRef} style={{ background: "#f8fafc", width: "100%", height: "100%", display: "block" }} />
        </div>
    );
}