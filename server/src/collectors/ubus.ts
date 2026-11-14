import http from 'node:http';
import https from 'node:https';
import {
  RouterConfig,
  RouterRole,
  RouterTelemetryPayload,
  RouterSystem,
  RouterMultiWan,
  RouterWifi,
  RouterWifiRadio,
  RouterConnectedClient,
  RouterWanInterface,
  RouterMemory,
} from '../types.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: unknown[];
}

interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number;
  result?: [number, T] | T;
  error?: { code: number; message: string; data?: unknown };
}

export class UbusClient {
  private config: RouterConfig;
  private password: string;
  private sessionId: string | null = null;
  private sessionExpiresAt: number = 0;
  private loginPromise: Promise<string> | null = null;
  private reqId: number = 1;
  private timeoutMs: number = 3000;

  constructor(config: RouterConfig, password: string) {
    this.config = config;
    this.password = password;
  }

  public updateCredentials(password: string): void {
    this.password = password;
    this.sessionId = null;
    this.sessionExpiresAt = 0;
  }

  public updateConfig(config: RouterConfig): void {
    this.config = config;
  }

  private postJson(body: unknown): Promise<unknown> {
    const isSsl = Boolean(this.config.ssl);
    const transport = isSsl ? https : http;
    const postData = JSON.stringify(body);

    return new Promise((resolve, reject) => {
      const req = transport.request(
        {
          hostname: this.config.host,
          port: this.config.port || (isSsl ? 443 : 80),
          path: '/ubus',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
            Accept: 'application/json',
          },
          timeout: this.timeoutMs,
        },
        (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
              reject(new Error(`HTTP ${res.statusCode}`));
              return;
            }
            try {
              const parsed = JSON.parse(data);
              resolve(parsed);
            } catch (err) {
              reject(new Error(`Failed to parse JSON response: ${(err as Error).message}`));
            }
          });
        }
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error(`Ubus request timed out after ${this.timeoutMs}ms`));
      });

      req.write(postData);
      req.end();
    });
  }

  private async ensureSession(): Promise<string> {
    const now = Date.now();
    if (this.sessionId && now < this.sessionExpiresAt - 30_000) {
      return this.sessionId;
    }

    if (this.loginPromise) {
      return this.loginPromise;
    }

    this.loginPromise = (async () => {
      try {
        const payload: JsonRpcRequest = {
          jsonrpc: '2.0',
          id: this.reqId++,
          method: 'call',
          params: [
            '00000000000000000000000000000000',
            'session',
            'login',
            { username: this.config.username, password: this.password },
          ],
        };

        const res = (await this.postJson(payload)) as JsonRpcResponse<{
          ubus_rpc_session: string;
          timeout: number;
          expires: number;
        }>;

        if (res.error) {
          throw new Error(`Login failed: ${res.error.message || 'Access denied'}`);
        }

        const result = res.result;
        if (!Array.isArray(result) || result[0] !== 0 || !result[1]?.ubus_rpc_session) {
          throw new Error('Invalid ubus credentials or session handshake');
        }

        const sessionData = result[1];
        this.sessionId = sessionData.ubus_rpc_session;
        const ttlSec = sessionData.expires || sessionData.timeout || 300;
        this.sessionExpiresAt = Date.now() + ttlSec * 1000;
        return this.sessionId;
      } finally {
        this.loginPromise = null;
      }
    })();

    return this.loginPromise;
  }

  public async call<T = any>(object: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
    let sid = await this.ensureSession();

    const makeRequest = async (currentSid: string) => {
      const payload: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: this.reqId++,
        method: 'call',
        params: [currentSid, object, method, args],
      };
      return (await this.postJson(payload)) as JsonRpcResponse<T>;
    };

    let res = await makeRequest(sid);

    // Code 6 means Access Denied or Session Expired. Invalidate and retry once.
    if (Array.isArray(res.result) && res.result[0] === 6) {
      this.sessionId = null;
      sid = await this.ensureSession();
      res = await makeRequest(sid);
    }

    if (res.error) {
      throw new Error(`RPC error ${res.error.code}: ${res.error.message}`);
    }

    if (Array.isArray(res.result)) {
      if (res.result[0] !== 0) {
        throw new Error(`RPC call ${object}.${method} failed with code ${res.result[0]}`);
      }
      return res.result[1] as T;
    }

    return res.result as T;
  }

  public async probe(): Promise<{
    ok: boolean;
    model?: string;
    hostname?: string;
    release?: string;
    kernel?: string;
    error?: string;
  }> {
    try {
      await this.ensureSession();
      const board = await this.call<any>('system', 'board');
      return {
        ok: true,
        model: board?.model || board?.system || 'OpenWrt Device',
        hostname: board?.hostname || 'OpenWrt',
        release: board?.release?.description || board?.release?.version || 'OpenWrt',
        kernel: board?.kernel,
      };
    } catch (err) {
      return {
        ok: false,
        error: (err as Error).message,
      };
    }
  }

  public async fetchTelemetry(
    role: RouterRole,
    dhcpLeasesMap?: Map<string, { ip: string; hostname: string }>
  ): Promise<RouterTelemetryPayload> {
    const [board, info, devicesRaw, wireless] = await Promise.all([
      this.call<any>('system', 'board').catch(() => null),
      this.call<any>('system', 'info').catch(() => null),
      this.call<Record<string, any>>('network.device', 'status').catch(() => ({})),
      this.call<Record<string, any>>('luci-rpc', 'getWirelessDevices').catch(() => ({})),
    ]);

    const devices = (devicesRaw && typeof devicesRaw === 'object' ? devicesRaw : {}) as Record<string, any>;

    if (!info) {
      throw new Error('Unable to retrieve system.info from router');
    }

    // 1. System stats
    const uptime = Number(info.uptime) || 0;
    const rawLoads = Array.isArray(info.load) ? info.load : [0, 0, 0];
    const loadAvg: [number, number, number] = [
      Number((rawLoads[0] / 65536).toFixed(2)) || 0,
      Number((rawLoads[1] / 65536).toFixed(2)) || 0,
      Number((rawLoads[2] / 65536).toFixed(2)) || 0,
    ];

    const memTotal = Number(info.memory?.total) || 1;
    const memFree = Number(info.memory?.free) || 0;
    const memAvail = Number(info.memory?.available) || (memFree + (Number(info.memory?.buffered) || 0) + (Number(info.memory?.cached) || 0));
    const memUsed = Math.max(0, memTotal - memAvail);

    const memory: RouterMemory = {
      total_bytes: memTotal,
      available_bytes: memAvail,
      used_bytes: memUsed,
      used_percent: Number(((memUsed / memTotal) * 100).toFixed(1)),
      swap_total_bytes: Number(info.swap?.total) || 0,
      swap_free_bytes: Number(info.swap?.free) || 0,
      swap_used_percent: 0,
    };

    const cpuCount = 4;
    const approxCpuPct = Math.min(100, Math.max(0, Number(((loadAvg[0] / cpuCount) * 100).toFixed(1))));

    const system: RouterSystem = {
      hostname: board?.hostname || 'OpenWrt',
      model: board?.model || board?.system || 'OpenWrt Router',
      kernel: board?.kernel || '',
      uptime_secs: uptime,
      load_average: loadAvg,
      cpu_count: cpuCount,
      cpu_usage_percent: approxCpuPct,
      memory,
      usb_storage: null,
    };

    // 2. Wireless radios & stations
    const radios: RouterWifiRadio[] = [];
    const connectedClients: RouterConnectedClient[] = [];

    if (wireless && typeof wireless === 'object') {
      const radioEntries = Object.entries(wireless);
      for (const [radioKey, radioData] of radioEntries) {
        if (!radioData || typeof radioData !== 'object') continue;

        const interfaces = Array.isArray(radioData.interfaces) ? radioData.interfaces : [];
        for (const iface of interfaces) {
          const ifname = iface.ifname;
          const iwinfo = iface.iwinfo || {};
          let stationCountOnRadio = 0;

          // Fetch stations on this AP interface
          if (ifname) {
            try {
              const assoc = await this.call<{ results?: any[] }>('iwinfo', 'assoclist', { device: ifname });
              const stationList = Array.isArray(assoc?.results) ? assoc.results : [];
              stationCountOnRadio = stationList.length;

              for (const s of stationList) {
                const mac = (s.mac || '').toUpperCase();
                const matchedLease = dhcpLeasesMap?.get(mac);

                connectedClients.push({
                  mac,
                  ip: matchedLease?.ip || '',
                  hostname: matchedLease?.hostname || matchedLease?.ip || mac,
                  connection_type: 'wifi',
                  signal_dbm: Number(s.signal) || -70,
                  tx_rate_mbps: s.tx?.rate ? Number((s.tx.rate / 1000).toFixed(1)) : null,
                });
              }
            } catch {
              // Non-fatal
            }
          }

          radios.push({
            device: ifname || radioKey,
            ssid: iwinfo.ssid || iface.config?.ssid || radioKey,
            mode: iwinfo.mode || iface.config?.mode || 'Master',
            channel: iwinfo.channel || Number(radioData.config?.channel) || null,
            frequency_ghz: iwinfo.frequency ? Number((iwinfo.frequency / 1000).toFixed(3)) : null,
            clients: stationCountOnRadio,
          });
        }
      }
    }

    const wifi: RouterWifi = {
      total_clients: connectedClients.length,
      radios,
      clients: connectedClients,
    };

    // 3. Multi-WAN or AP bridge info
    let multiWan: RouterMultiWan | undefined = undefined;
    let apInfo: RouterTelemetryPayload['ap'] = undefined;

    if (role === 'gateway') {
      try {
        const mwan3 = await this.call<any>('mwan3', 'status');
        const mwanIfaces = mwan3?.interfaces || {};
        const wanList: RouterWanInterface[] = [];

        for (const [ifaceName, ifaceData] of Object.entries(mwanIfaces) as [string, any][]) {
          const isOnline = ifaceData?.status === 'online';
          const isPrimary = ifaceName === 'wan';
          wanList.push({
            name: ifaceName,
            device: ifaceData?.device || ifaceName,
            label: isPrimary ? 'Primary WAN' : 'Backup WAN',
            role: isPrimary ? 'primary' : 'backup',
            status: isOnline ? 'online' : (ifaceData?.status || 'offline'),
            online: isOnline,
            latency_ms: ifaceData?.latency ? Number(ifaceData.latency) : null,
            uptime: null,
          });
        }

        const activeWan = wanList.find((w) => w.online);
        multiWan = {
          source: 'mwan3',
          interfaces: wanList,
          active: activeWan ? activeWan.name : null,
          failover: Boolean(wanList.find((w) => !w.online && w.role === 'primary') && wanList.find((w) => w.online && w.role === 'backup')),
        };
      } catch {
        // Fallback for gateway if mwan3 is not present
        const wanDev = devices['wan'] || devices['pppoe-wan'];
        if (wanDev) {
          multiWan = {
            source: 'sysfs',
            interfaces: [
              {
                name: 'wan',
                device: 'wan',
                label: 'WAN Interface',
                role: 'primary',
                status: wanDev.up ? 'online' : 'offline',
                online: Boolean(wanDev.up),
                latency_ms: null,
                uptime: null,
              },
            ],
            active: wanDev.up ? 'wan' : null,
            failover: false,
          };
        }
      }
    } else {
      // AP role: provide upstream info
      const brLan = devices['br-lan'];
      apInfo = {
        upstream_ip: '192.168.0.1',
        upstream_reachable: Boolean(brLan?.up),
        upstream_latency_ms: null,
        bridge_dev: 'br-lan',
      };
    }

    return {
      timestamp: Date.now(),
      version: '1.2.0-ubus',
      role,
      system,
      multi_wan: multiWan,
      wifi,
      ap: apInfo,
    };
  }

  public async fetchDhcpLeases(): Promise<Map<string, { ip: string; hostname: string }>> {
    const map = new Map<string, { ip: string; hostname: string }>();
    try {
      const leases = await this.call<{ leases?: any[] }>('luci-rpc', 'getDHCPLeases');
      const list = Array.isArray(leases?.leases) ? leases.leases : [];
      for (const item of list) {
        if (item.macaddr && item.ipaddr) {
          map.set(item.macaddr.toUpperCase(), {
            ip: item.ipaddr,
            hostname: item.hostname || item.ipaddr,
          });
        }
      }
    } catch {
      try {
        const v4 = await this.call<{ device?: Record<string, { leases?: any[] }> }>('dhcp', 'ipv4leases');
        if (v4?.device) {
          for (const dev of Object.values(v4.device)) {
            if (Array.isArray(dev.leases)) {
              for (const l of dev.leases) {
                if (l.mac && l.ip) {
                  map.set(l.mac.toUpperCase(), {
                    ip: l.ip,
                    hostname: l.hostname || l.ip,
                  });
                }
              }
            }
          }
        }
      } catch {
        // DHCP lease lookup failed
      }
    }
    return map;
  }
}
