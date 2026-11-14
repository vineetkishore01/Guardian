import {
  RouterConfig,
  RouterFleet,
  RouterFleetSummary,
  RouterRole,
  RouterTelemetry,
  RouterTelemetryPayload,
} from '../types.js';
import { UbusClient } from './ubus.js';
import {
  loadUserConfig,
  addOrUpdateRouterConfig,
  deleteRouterConfig as deleteConfigFromStore,
} from '../store.js';
import {
  getRouterPassword,
  setRouterPassword,
  deleteRouterPassword,
  hasRouterPassword,
} from '../secrets.js';
import { logger } from '../logger.js';

interface NodeRuntimeState {
  config: RouterConfig;
  client: UbusClient;
  telemetry: RouterTelemetry;
  lastGood: RouterTelemetryPayload | null;
  lastGoodAt: number | null;
  consecutiveFailures: number;
}

const STALE_LIMIT_MS = 5 * 60_000;
const POLL_INTERVAL_MS = 6_000;

class RouterFleetManager {
  private nodes: Map<string, NodeRuntimeState> = new Map();
  private pollTimer: NodeJS.Timeout | null = null;
  private isPolling: boolean = false;
  private dhcpLeasesCache: Map<string, { ip: string; hostname: string }> = new Map();

  constructor() {
    this.initFleet();
  }

  private initFleet(): void {
    const config = loadUserConfig();
    let routers = config.routers || [];

    // If no routers are configured, auto-seed with ASUS gateway and JIDU bedroom AP
    if (routers.length === 0) {
      const defaultPassword = process.env.ROUTER_DEFAULT_PASSWORD || '';

      const asusConfig: RouterConfig = {
        id: 'asus-gateway',
        label: 'Living Room (ASUS RT-AX53U)',
        host: '192.168.0.1',
        port: 80,
        ssl: false,
        username: 'root',
        role: 'gateway',
        enabled: true,
      };

      const jiduConfig: RouterConfig = {
        id: 'jidu-bedroom',
        label: 'Bedroom (JioRouter AX6000)',
        host: '192.168.0.2',
        port: 80,
        ssl: false,
        username: 'root',
        role: 'ap',
        enabled: true,
      };

      if (defaultPassword) {
        setRouterPassword(asusConfig.id, defaultPassword);
        setRouterPassword(jiduConfig.id, defaultPassword);
      }
      addOrUpdateRouterConfig(asusConfig);
      addOrUpdateRouterConfig(jiduConfig);
      routers = [asusConfig, jiduConfig];
      logger.info('fleet', 'Seeded initial router fleet', { count: routers.length });
    }

    for (const r of routers) {
      this.registerNode(r);
    }
  }

  private registerNode(config: RouterConfig): void {
    const password = getRouterPassword(config.id) || '';
    const client = new UbusClient(config, password);

    const initialTelemetry: RouterTelemetry = {
      id: config.id,
      label: config.label,
      role: config.role,
      status: 'offline',
      endpoint: `http://${config.host}:${config.port || 80}/ubus`,
      fetchedAt: null,
      data: null,
    };

    this.nodes.set(config.id, {
      config,
      client,
      telemetry: initialTelemetry,
      lastGood: null,
      lastGoodAt: null,
      consecutiveFailures: 0,
    });
  }

  public start(): void {
    if (this.pollTimer) return;
    this.pollAll();
    this.pollTimer = setInterval(() => {
      this.pollAll();
    }, POLL_INTERVAL_MS);
    logger.info('fleet', 'Router fleet background poller started', { intervalMs: POLL_INTERVAL_MS });
  }

  public stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async pollAll(): Promise<void> {
    if (this.isPolling) return;
    this.isPolling = true;

    try {
      // Step 1: Poll gateways first to refresh DHCP leases
      const gatewayNodes = Array.from(this.nodes.values()).filter(
        (n) => n.config.enabled && n.config.role === 'gateway'
      );

      for (const node of gatewayNodes) {
        try {
          const leases = await node.client.fetchDhcpLeases();
          if (leases.size > 0) {
            this.dhcpLeasesCache = leases;
          }
        } catch {
          // Non-fatal
        }
      }

      // Step 2: Poll all enabled nodes concurrently
      const enabledNodes = Array.from(this.nodes.values()).filter((n) => n.config.enabled);

      await Promise.allSettled(
        enabledNodes.map(async (node) => {
          try {
            const data = await node.client.fetchTelemetry(node.config.role, this.dhcpLeasesCache);
            node.lastGood = data;
            node.lastGoodAt = Date.now();
            node.consecutiveFailures = 0;

            node.telemetry = {
              id: node.config.id,
              label: node.config.label,
              role: node.config.role,
              status: 'live',
              endpoint: `http://${node.config.host}:${node.config.port || 80}/ubus`,
              fetchedAt: node.lastGoodAt,
              data,
            };
          } catch (err) {
            node.consecutiveFailures++;
            const message = (err as Error).message;
            const fresh = node.lastGoodAt !== null && Date.now() - node.lastGoodAt < STALE_LIMIT_MS;

            node.telemetry = {
              id: node.config.id,
              label: node.config.label,
              role: node.config.role,
              status: fresh ? 'stale' : 'offline',
              endpoint: `http://${node.config.host}:${node.config.port || 80}/ubus`,
              fetchedAt: node.lastGoodAt,
              error: message,
              data: fresh ? node.lastGood : null,
            };

            if (node.consecutiveFailures === 1) {
              logger.warn('fleet', `Router ${node.config.label} unreachable`, { error: message });
            }
          }
        })
      );
    } finally {
      this.isPolling = false;
    }
  }

  public getFleetTelemetry(): RouterFleet {
    const nodes = Array.from(this.nodes.values()).map((n) => n.telemetry);

    let live = 0;
    let stale = 0;
    let offline = 0;
    let totalClients = 0;

    for (const node of nodes) {
      if (node.status === 'live') live++;
      else if (node.status === 'stale') stale++;
      else offline++;

      if (node.data?.wifi?.total_clients) {
        totalClients += node.data.wifi.total_clients;
      }
    }

    const summary: RouterFleetSummary = {
      total: nodes.length,
      live,
      stale,
      offline,
      totalClients,
    };

    return {
      nodes,
      summary,
    };
  }

  public getPrimaryRouterTelemetry(): RouterTelemetry | undefined {
    const nodes = Array.from(this.nodes.values());
    const gateway = nodes.find((n) => n.config.role === 'gateway') || nodes[0];
    return gateway ? gateway.telemetry : undefined;
  }

  public getRouterConfigs(): RouterConfig[] {
    const config = loadUserConfig();
    return (config.routers || []).map((r) => ({
      ...r,
      hasPassword: hasRouterPassword(r.id),
    }));
  }

  public async testConnection(
    probeConfig: Partial<RouterConfig> & { password?: string }
  ): Promise<{ ok: boolean; model?: string; hostname?: string; release?: string; error?: string }> {
    const dummyConfig: RouterConfig = {
      id: probeConfig.id || 'probe',
      label: probeConfig.label || 'Probe Node',
      host: probeConfig.host || '127.0.0.1',
      port: probeConfig.port || 80,
      ssl: Boolean(probeConfig.ssl),
      username: probeConfig.username || 'root',
      role: probeConfig.role || 'gateway',
      enabled: true,
    };

    const password = probeConfig.password || (probeConfig.id ? getRouterPassword(probeConfig.id) : '') || '';
    const client = new UbusClient(dummyConfig, password);
    return await client.probe();
  }

  public addOrUpdateRouter(config: RouterConfig, password?: string): void {
    if (password) {
      setRouterPassword(config.id, password);
    }

    addOrUpdateRouterConfig(config);

    const existing = this.nodes.get(config.id);
    if (existing) {
      existing.config = config;
      existing.client.updateConfig(config);
      if (password) {
        existing.client.updateCredentials(password);
      }
    } else {
      this.registerNode(config);
    }

    // Trigger immediate poll
    this.pollAll();
  }

  public deleteRouter(id: string): void {
    deleteRouterPassword(id);
    deleteConfigFromStore(id);
    this.nodes.delete(id);
  }
}

export const routerFleetManager = new RouterFleetManager();
