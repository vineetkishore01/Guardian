import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FullDashboardState,
  ContainerItem,
  CustomAppBookmark,
  DashboardSettings,
  ServiceProbeResult,
} from '../types/dashboard';

/** Fallback poll cadence when the SSE stream is unavailable. */
const FALLBACK_POLL_MS = 15000;

async function postJson(url: string, body?: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

export function useLiveTelemetry() {
  const [data, setData] = useState<FullDashboardState | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [connected, setConnected] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const connectedRef = useRef<boolean>(false);
  connectedRef.current = connected;

  // Guards against a slow in-flight response overwriting newer stream data.
  const lastAppliedAt = useRef<number>(0);

  const applyState = useCallback((payload: FullDashboardState, receivedAt: number) => {
    if (receivedAt < lastAppliedAt.current) return;
    lastAppliedAt.current = receivedAt;
    setData(payload);
    setLoading(false);
  }, []);

  const fetchStatus = useCallback(async (): Promise<boolean> => {
    const startedAt = Date.now();
    try {
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: FullDashboardState = await res.json();
      applyState(json, startedAt);
      setError(null);
      return true;
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
      return false;
    }
  }, [applyState]);

  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;

    fetchStatus();

    try {
      es = new EventSource('/api/live');

      es.onopen = () => {
        if (cancelled) return;
        setConnected(true);
        setError(null);
      };

      es.onmessage = (event) => {
        if (cancelled) return;
        try {
          applyState(JSON.parse(event.data) as FullDashboardState, Date.now());
          setConnected(true);
          setError(null);
        } catch (err) {
          console.error('[Guardian] Malformed telemetry frame:', err);
        }
      };

      es.onerror = () => {
        if (cancelled) return;
        // EventSource reconnects on its own; surface the gap and let the
        // interval below keep data flowing meanwhile.
        setConnected(false);
        setError((prev) => prev ?? 'stream disconnected');
      };
    } catch (err) {
      console.warn('[Guardian] SSE unavailable, falling back to polling:', err);
      setError('stream unavailable');
    }

    const interval = window.setInterval(() => {
      // Skip work while the tab is hidden or the stream is healthy.
      if (document.visibilityState === 'hidden') return;
      if (!connectedRef.current) fetchStatus();
    }, FALLBACK_POLL_MS);

    // Refresh immediately when the user returns to a stale tab.
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && !connectedRef.current) fetchStatus();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
      es?.close();
    };
  }, [fetchStatus, applyState]);

  const mutate = useCallback(
    async (run: () => Promise<Response>, failureMessage: string): Promise<boolean> => {
      try {
        const res = await run();
        if (!res.ok) throw new Error(`${failureMessage} (HTTP ${res.status})`);
        await fetchStatus();
        return true;
      } catch (err) {
        setError((err as Error).message);
        return false;
      }
    },
    [fetchStatus]
  );

  const updateContainer = useCallback(
    (name: string, updates: Partial<ContainerItem>) =>
      mutate(
        () => postJson(`/api/containers/${encodeURIComponent(name)}/custom`, updates),
        'Failed to update container'
      ),
    [mutate]
  );

  const restartContainer = useCallback(
    (idOrName: string) =>
      mutate(
        () => postJson(`/api/containers/${encodeURIComponent(idOrName)}/restart`),
        'Failed to restart container'
      ),
    [mutate]
  );

  const addCustomApp = useCallback(
    (app: Partial<CustomAppBookmark>) =>
      mutate(() => postJson('/api/custom-apps', app), 'Failed to save bookmark'),
    [mutate]
  );

  const deleteCustomApp = useCallback(
    (id: string) =>
      mutate(
        () => fetch(`/api/custom-apps/${encodeURIComponent(id)}`, { method: 'DELETE' }),
        'Failed to delete bookmark'
      ),
    [mutate]
  );

  const updateSettings = useCallback(
    (settings: Partial<DashboardSettings>) =>
      mutate(() => postJson('/api/config/settings', settings), 'Failed to update settings'),
    [mutate]
  );

  const pruneDocker = useCallback(async (
    scope: 'dangling' | 'all' = 'dangling'
  ): Promise<{ spaceReclaimedBytes: number } | null> => {
    try {
      const res = await postJson('/api/docker/prune', { scope });
      if (!res.ok) throw new Error(`Failed to prune images (HTTP ${res.status})`);
      const result = await res.json();
      await fetchStatus();
      return result;
    } catch (err) {
      setError((err as Error).message);
      return null;
    }
  }, [fetchStatus]);

  const refreshProbes = useCallback(async (): Promise<ServiceProbeResult[]> => {
    try {
      const res = await postJson('/api/probes/refresh');
      if (!res.ok) throw new Error(`Failed to refresh probes (HTTP ${res.status})`);
      const probes: ServiceProbeResult[] = await res.json();
      if (Array.isArray(probes)) {
        setData((prev) => (prev ? { ...prev, probes } : prev));
      }
      return probes;
    } catch (err) {
      setError((err as Error).message);
      return [];
    }
  }, []);

  return {
    data,
    loading,
    connected,
    error,
    refetch: fetchStatus,
    updateContainer,
    restartContainer,
    addCustomApp,
    deleteCustomApp,
    updateSettings,
    pruneDocker,
    refreshProbes,
  };
}
