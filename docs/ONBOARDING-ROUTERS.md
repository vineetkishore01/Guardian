# Onboarding Routers onto Guardian Dashboard (Agentless)

Guardian features a **100% agentless** multi-router telemetry architecture. You do **not** need to install, compile, or run any custom binaries or agents on your routers. Guardian queries OpenWrt's native `/ubus` JSON-RPC HTTP API over your local network out of the box.

---

## 1. Quick Onboarding via the Dashboard UI (Recommended)

1. Open your Guardian dashboard (e.g. `http://<server-ip>:3001`).
2. Scroll to the **Internet & WAN** section.
3. On the **Network Fleet** card, click **Manage Fleet** in the top-right corner.
4. In the **Onboard New Router** dialog, provide:
   - **Display Label**: A friendly name (e.g., `Living Room (Gateway)` or `Bedroom (Access Point)`).
   - **Router Role**:
     - **Primary Gateway**: Tracks WAN links, multi-WAN failover, public IP, ping latency, and DNS.
     - **Access Point / Mesh Node**: Tracks bridged Wi-Fi radios (2.4GHz / 5GHz), SSIDs, channel frequencies, TX power, link speed, and all connected wireless stations.
   - **IP Address / Hostname**: Local IPv4 address of the router (e.g. `192.168.0.1` or `192.168.0.2`).
   - **HTTP Port**: Default is `80` (or `443` if using HTTPS).
   - **Username**: Default is `root`.
   - **Password**: Your LuCI web / SSH root password.
5. Click **Test Connection**: Guardian will send a live non-destructive JSON-RPC probe to verify connectivity, returning your router's hardware model and OpenWrt version.
6. Click **Save Router**: The router is immediately added to the background polling loop.

---

## 2. Headless Configuration via `/data/guardian.json`

If deploying Guardian via Docker or automating router fleet provisioning, you can configure routers declaratively in `/data/guardian.json`:

```json
{
  "routers": [
    {
      "id": "gateway-asus",
      "label": "Living Room (ASUS RT-AX53U)",
      "host": "192.168.0.1",
      "port": 80,
      "ssl": false,
      "username": "root",
      "role": "gateway",
      "enabled": true
    },
    {
      "id": "ap-bedroom",
      "label": "Bedroom (JioRouter AX6000)",
      "host": "192.168.0.2",
      "port": 80,
      "ssl": false,
      "username": "root",
      "role": "ap",
      "enabled": true
    }
  ]
}
```

> **Security Note**: Router passwords are kept strictly out of `guardian.json` and are saved in an isolated, restricted permissions store (`/data/secrets.json`) so they are never exposed to API consumers, frontend clients, or git backups.

---

## 3. How It Works Under the Hood

- **Zero Flash/NAND Wear**: Guardian reads runtime Linux statistics from `/proc/stat`, sysfs, `network.device`, and `iwinfo` purely in memory.
- **Asynchronous Polling**: Router polling runs decoupled from the dashboard's main 2-second tick in a background daemon (`RouterFleetManager`) with failure backoff and keep-alive socket pooling. An offline AP will never cause the dashboard to hang or slow down.
- **Client IP & Hostname Enrichment**: Secondary dumb APs that bridge LAN traffic have their connected station MACs automatically correlated with the primary gateway's DHCP leases to present human-readable hostnames and IP addresses.
