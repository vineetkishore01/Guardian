import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FullDashboardState,
  ContainerItem,
  CustomAppBookmark,
  DashboardSettings,
  ServiceProbeResult,
} from '../types/dashboard';

export function useLiveTelemetry() {
  const [data, setData] = useState<FullDashboardState | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [connected, setConnected] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const connectedRef = useRef<boolean>(false);

  useEffect(() => {
    connectedRef.current = connected;
  }, [connected]);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: FullDashboardState = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial fetch
    fetchStatus();

    // SSE connection
    let es: EventSource | null = null;
    try {
      es = new EventSource('/api/live');

      es.onopen = () => {
        setConnected(true);
        setError(null);
      };

      es.onmessage = (event) => {
        try {
          const payload: FullDashboardState = JSON.parse(event.data);
          setData(payload);
          setLoading(false);
          setConnected(true);
        } catch (e) {
          console.error('[SSE Parse Error]:', e);
        }
      };

      es.onerror = () => {
        setConnected(false);
      };
    } catch (e) {
      console.warn('[SSE Init Failed]:', e);
    }

    // Interval fallback when SSE is disconnected
    const interval = setInterval(() => {
      if (!connectedRef.current) {
        fetchStatus();
      }
    }, 15000);

    return () => {
      clearInterval(interval);
      if (es) {
        es.close();
      }
    };
  }, [fetchStatus]);

  const updateContainer = async (
    name: string,
    updates: Partial<ContainerItem>
  ) => {
    try {
      const res = await fetch(`/api/containers/${encodeURIComponent(name)}/custom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Failed to update container');
      await fetchStatus();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  };

  const addCustomApp = async (app: Partial<CustomAppBookmark>) => {
    try {
      const res = await fetch('/api/custom-apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(app),
      });
      if (!res.ok) throw new Error('Failed to add app');
      await fetchStatus();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  };

  const deleteCustomApp = async (id: string) => {
    try {
      const res = await fetch(`/api/custom-apps/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete app');
      await fetchStatus();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  };

  const updateSettings = async (settings: Partial<DashboardSettings>) => {
    try {
      const res = await fetch('/api/config/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error('Failed to update settings');
      await fetchStatus();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  };

  const pruneDocker = async (): Promise<{ spaceReclaimedBytes: number } | null> => {
    try {
      const res = await fetch('/api/docker/prune', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to prune Docker images');
      const data = await res.json();
      await fetchStatus();
      return data;
    } catch (err) {
      setError((err as Error).message);
      return null;
    }
  };

  const refreshProbes = async (): Promise<ServiceProbeResult[]> => {
    try {
      const res = await fetch('/api/probes/refresh', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to refresh probes');
      const data: ServiceProbeResult[] = await res.json();
      if (data) {
        setData((prev) => (prev ? { ...prev, probes: data } : null));
      }
      return data;
    } catch (err) {
      setError((err as Error).message);
      return [];
    }
  };

  return {
    data,
    loading,
    connected,
    error,
    refetch: fetchStatus,
    updateContainer,
    addCustomApp,
    deleteCustomApp,
    updateSettings,
    pruneDocker,
    refreshProbes,
  };
}
