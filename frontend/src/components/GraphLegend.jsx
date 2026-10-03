import React, { useState } from 'react';

export default function GraphLegend() {
    const [collapsed, setCollapsed] = useState(false);

    const legendItems = [
        { type: 'node', label: 'Package / Folder', color: '#3b82f6', r: 7 },
        { type: 'node', label: 'Internal Module', color: '#10b981', r: 7 },
        { type: 'node', label: 'External Library', color: '#64748b', r: 7 },
        { type: 'node', label: 'Class', color: '#a855f7', r: 6 },
        { type: 'node', label: 'Function / Method', color: '#f59e0b', r: 5 },
        { type: 'line', label: 'Contains (Parent/Child)', color: '#8e9092', dash: '3,3', width: 1.5 },
        { type: 'line', label: 'Internal Call', color: '#ec4899', dash: 'none', width: 2 },
        { type: 'line', label: 'External Call', color: '#f97316', dash: 'none', width: 2 },
        { type: 'line', label: 'Import Dependency', color: '#94a3b8', dash: 'none', width: 1.5 },
        { type: 'line', label: 'Cross-Language API Call', color: '#06b6d4', dash: '6,3', width: 2.5 }
    ];

    return (
        <div style={{
            position: 'absolute', bottom: 24, left: 24, zIndex: 15,
            background: 'rgba(255, 255, 255, 0.85)', backdropFilter: 'blur(12px)',
            border: '1px solid rgba(0, 0, 0, 0.08)', borderRadius: '14px',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05)',
            fontFamily: 'Inter, sans-serif', width: collapsed ? 'auto' : '230px',
            transition: 'all 0.2s ease', overflow: 'hidden'
        }}>
            <div 
                onClick={() => setCollapsed(!collapsed)}
                style={{
                    padding: '12px 16px', display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', cursor: 'pointer', userSelect: 'none',
                    borderBottom: collapsed ? 'none' : '1px solid rgba(0,0,0,0.06)'
                }}
            >
                <span style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>
                    Map Legend
                </span>
                <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>
                    {collapsed ? '▲ Show' : '▼ Hide'}
                </span>
            </div>

            {!collapsed && (
                <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {legendItems.map((item, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <div style={{ width: '24px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                                {item.type === 'node' ? (
                                    <div style={{
                                        width: item.r * 2, height: item.r * 2, borderRadius: '50%',
                                        backgroundColor: item.color, border: '1.5px solid #ffffff',
                                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                                    }} />
                                ) : (
                                    <div style={{
                                        width: '20px', height: '0px',
                                        borderTop: `${item.width}px ${item.dash === 'none' ? 'solid' : 'dashed'} ${item.color}`
                                    }} />
                                )}
                            </div>
                            <span style={{ fontSize: '11px', color: '#475569', fontWeight: 500 }}>
                                {item.label}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}