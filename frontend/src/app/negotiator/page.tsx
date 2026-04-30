'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import styles from './page.module.css';

type BridgeInfo = {
    connected: boolean;
    toolCount: number;
    tools: string[];
};

type BridgeStatus = {
    connected: boolean;
    bridges: Record<string, BridgeInfo>;
    tools: Array<{ name: string; agent: string; description?: string }>;
};

type Stats = {
    totalLeads: number;
    byStatus: Record<string, number>;
    totalMissions: number;
    completedMissions: number;
    runningMissions: number;
};

export default function NegotiatorPage() {
    const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus | null>(null);
    const [stats, setStats] = useState<Stats | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchStatus = async () => {
            try {
                const status = await api.get<BridgeStatus>('/api/mcp-bridge/status', { timeout: 3000 });
                setBridgeStatus(status);

                // If bridge is connected, try to get stats via bridge
                if (status?.bridges?.negoapp?.connected) {
                    try {
                        const statsRes = await api.post<{ success: boolean; result: Stats }>('/api/mcp-bridge/call', {
                            agent: 'negoapp',
                            tool: 'nego_get_stats',
                            params: {},
                        });
                        if (statsRes?.success) setStats(statsRes.result);
                    } catch { /* ignore */ }
                }
            } catch { /* ignore */ }
            setLoading(false);
        };
        fetchStatus();
        const interval = setInterval(fetchStatus, 10000);
        return () => clearInterval(interval);
    }, []);

    const negoConnected = bridgeStatus?.bridges?.negoapp?.connected ?? false;
    const bookConnected = bridgeStatus?.bridges?.book2?.connected ?? false;
    const negoTools = bridgeStatus?.bridges?.negoapp?.tools || [];

    return (
        <div className={styles.container}>
            <div className={styles.card}>
                {/* Header */}
                <div className={styles.header}>
                    <div className={styles.icon}>🤝</div>
                    <div>
                        <h1 className={styles.title}>Negotiator</h1>
                        <p className={styles.subtitle}>
                            Autonomous AI Negotiator — marketplace scanning, contact extraction, auto-negotiation
                        </p>
                    </div>
                </div>

                {/* Bridge Status */}
                <div className={styles.statusSection}>
                    <h3 className={styles.sectionTitle}>MCP Bridges</h3>
                    <div className={styles.statusGrid}>
                        <div className={`${styles.statusItem} ${negoConnected ? styles.connected : styles.disconnected}`}>
                            <span className={styles.statusDot} />
                            <span className={styles.statusLabel}>NegoApp</span>
                            <span className={styles.statusValue}>
                                {loading ? '...' : negoConnected ? `${negoTools.length} tools` : 'Offline'}
                            </span>
                        </div>
                        <div className={`${styles.statusItem} ${bookConnected ? styles.connected : styles.disconnected}`}>
                            <span className={styles.statusDot} />
                            <span className={styles.statusLabel}>Book2</span>
                            <span className={styles.statusValue}>
                                {loading ? '...' : bookConnected ? 'Connected' : 'Offline'}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Stats (only when bridge connected) */}
                {negoConnected && stats && (
                    <div className={styles.statsSection}>
                        <h3 className={styles.sectionTitle}>Live Stats (via Bridge)</h3>
                        <div className={styles.statsGrid}>
                            <div className={styles.statCard}>
                                <div className={styles.statValue}>{stats.totalLeads}</div>
                                <div className={styles.statLabel}>Leads</div>
                            </div>
                            <div className={styles.statCard}>
                                <div className={styles.statValue}>{stats.totalMissions}</div>
                                <div className={styles.statLabel}>Missions</div>
                            </div>
                            <div className={styles.statCard}>
                                <div className={styles.statValue}>{stats.completedMissions}</div>
                                <div className={styles.statLabel}>Completed</div>
                            </div>
                            <div className={styles.statCard}>
                                <div className={styles.statValue}>{stats.runningMissions}</div>
                                <div className={styles.statLabel}>Running</div>
                            </div>
                        </div>
                        {stats.byStatus && Object.keys(stats.byStatus).length > 0 && (
                            <div className={styles.byStatus}>
                                {Object.entries(stats.byStatus).map(([status, count]) => (
                                    <span key={status} className={styles.statusBadge}>
                                        {status}: {count}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Tools list */}
                {negoConnected && negoTools.length > 0 && (
                    <div className={styles.toolsSection}>
                        <h3 className={styles.sectionTitle}>Available Tools ({negoTools.length})</h3>
                        <div className={styles.toolsList}>
                            {negoTools.map((tool) => (
                                <span key={tool} className={styles.toolBadge}>{tool}</span>
                            ))}
                        </div>
                    </div>
                )}

                {/* Info box */}
                <div className={styles.infoBox}>
                    {negoConnected ? (
                        <>
                            <p className={styles.infoTitle}>✅ Bridge Active — Full NegoApp Access</p>
                            <p className={styles.infoText}>
                                Use the Orchestrator to interact: &quot;arată-mi lead-urile din nego&quot;, 
                                &quot;scanează OLX pentru iPhone 15&quot;, &quot;care e statusul WhatsApp pe nego?&quot;
                            </p>
                        </>
                    ) : (
                        <>
                            <p className={styles.infoTitle}>⚠️ NegoApp Bridge Offline</p>
                            <p className={styles.infoText}>
                                Start the bridge on VPS: <code>cd NegoApp && npm run bridge</code><br />
                                Local fallback available for scraping via Orchestrator.
                            </p>
                            <code className={styles.codeBlock}>
                                &quot;scanează OLX pentru iPhone 15 sub 2000 lei&quot;
                            </code>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
