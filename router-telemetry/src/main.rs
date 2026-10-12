//! router-telemetry: a tiny, dependency-light telemetry daemon for OpenWrt.
//!
//! Design: one background sampler thread refreshes a pre-serialised JSON
//! snapshot on a fixed cadence; the HTTP loop only ever copies that buffer to
//! the socket. Requests therefore cost no /proc parsing and no process spawns,
//! and the steady-state footprint is a few hundred KiB of heap.

use serde::Serialize;
use std::fs;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::process::{Command, Stdio};
use std::sync::{Arc, RwLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/* ------------------------------------------------------------------ *
 * Configuration
 * ------------------------------------------------------------------ */

#[derive(Clone)]
struct Config {
    port: u16,
    model: String,
    usb_mount: String,
    vnstat_dbdir: String,
    /// mwan3 logical interface / kernel device / display label for each uplink.
    primary: Uplink,
    backup: Uplink,
    sample_secs: u64,
}

#[derive(Clone)]
struct Uplink {
    iface: String,
    device: String,
    label: String,
}

impl Config {
    fn from_args() -> Config {
        let mut c = Config {
            port: 9191,
            model: "ASUS RT-AX53U".into(),
            usb_mount: "/mnt/usb".into(),
            vnstat_dbdir: "/mnt/usb/vnstat".into(),
            primary: Uplink {
                iface: "wan".into(),
                device: "pppoe-wan".into(),
                label: "ACT Fibernet".into(),
            },
            backup: Uplink {
                iface: "wwan".into(),
                device: "phy0-sta0".into(),
                label: "Neighbor Wi-Fi".into(),
            },
            sample_secs: 5,
        };
        let args: Vec<String> = std::env::args().skip(1).collect();
        let mut i = 0;
        while i < args.len() {
            let flag = args[i].as_str();
            if flag == "-h" || flag == "--help" {
                println!(
                    "router-telemetry [--port 9191] [--model NAME] [--usb-mount /mnt/usb]\n\
                     \x20 [--vnstat-dbdir DIR] [--primary-iface wan] [--primary-dev pppoe-wan]\n\
                     \x20 [--primary-label NAME] [--backup-iface wwan] [--backup-dev phy0-sta0]\n\
                     \x20 [--backup-label NAME] [--interval SECS]"
                );
                std::process::exit(0);
            }
            let val = match args.get(i + 1) {
                Some(v) => v.clone(),
                None => {
                    eprintln!("missing value for {flag}");
                    std::process::exit(2);
                }
            };
            match flag {
                "--port" => c.port = val.parse().unwrap_or(9191),
                "--model" => c.model = val,
                "--usb-mount" => c.usb_mount = val,
                "--vnstat-dbdir" => c.vnstat_dbdir = val,
                "--primary-iface" => c.primary.iface = val,
                "--primary-dev" => c.primary.device = val,
                "--primary-label" => c.primary.label = val,
                "--backup-iface" => c.backup.iface = val,
                "--backup-dev" => c.backup.device = val,
                "--backup-label" => c.backup.label = val,
                "--interval" => c.sample_secs = val.parse::<u64>().unwrap_or(5).max(1),
                _ => {
                    eprintln!("unknown flag {flag}");
                    std::process::exit(2);
                }
            }
            i += 2;
        }
        c
    }
}

/* ------------------------------------------------------------------ *
 * Wire format (mirrored by server/src/types.ts RouterTelemetry)
 * ------------------------------------------------------------------ */

#[derive(Serialize, Default)]
struct Telemetry {
    timestamp: u64,
    version: &'static str,
    system: System,
    multi_wan: MultiWan,
    isp_bandwidth: Vec<IspBandwidth>,
    wifi: Wifi,
    adguard: AdGuard,
}

#[derive(Serialize, Default)]
struct System {
    hostname: String,
    model: String,
    kernel: String,
    uptime_secs: f64,
    load_average: [f64; 3],
    cpu_count: u32,
    cpu_usage_percent: f64,
    memory: Memory,
    usb_storage: Option<Storage>,
}

#[derive(Serialize, Default)]
struct Memory {
    total_bytes: u64,
    available_bytes: u64,
    used_bytes: u64,
    used_percent: f64,
    swap_total_bytes: u64,
    swap_free_bytes: u64,
    swap_used_percent: f64,
}

#[derive(Serialize, Default)]
struct Storage {
    mount: String,
    total_bytes: u64,
    free_bytes: u64,
    used_bytes: u64,
    used_percent: f64,
}

#[derive(Serialize, Default)]
struct MultiWan {
    /// "mwan3" when parsed from mwan3, "sysfs" when inferred from link state.
    source: String,
    interfaces: Vec<WanIface>,
    /// Logical interface currently carrying default traffic.
    active: Option<String>,
    /// True when the primary uplink is down and the backup is carrying traffic.
    failover: bool,
}

#[derive(Serialize, Default, Clone)]
struct WanIface {
    name: String,
    device: String,
    label: String,
    role: &'static str,
    status: String,
    online: bool,
    latency_ms: Option<f64>,
    uptime: Option<String>,
}

#[derive(Serialize, Default, Clone)]
struct IspBandwidth {
    interface: String,
    label: String,
    role: &'static str,
    today_rx_bytes: u64,
    today_tx_bytes: u64,
    month_rx_bytes: u64,
    month_tx_bytes: u64,
}

#[derive(Serialize, Default, Clone)]
struct Wifi {
    total_clients: u32,
    radios: Vec<Radio>,
}

#[derive(Serialize, Default, Clone)]
struct Radio {
    device: String,
    ssid: String,
    mode: String,
    channel: Option<u32>,
    frequency_ghz: Option<f64>,
    clients: u32,
}

#[derive(Serialize, Default)]
struct AdGuard {
    port53_tcp: bool,
    port53_udp: bool,
    dns_responding: bool,
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

fn read(path: &str) -> Option<String> {
    fs::read_to_string(path).ok()
}

/// Runs a command with stdin/stderr closed. Missing binaries yield `None`.
fn run(cmd: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(cmd)
        .args(args)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !out.status.success() && out.stdout.is_empty() {
        return None;
    }
    String::from_utf8(out.stdout).ok()
}

fn pct(used: u64, total: u64) -> f64 {
    if total == 0 {
        0.0
    } else {
        ((used as f64 / total as f64) * 1000.0).round() / 10.0
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/* ------------------------------------------------------------------ *
 * System
 * ------------------------------------------------------------------ */

struct CpuSample {
    idle: u64,
    total: u64,
}

fn read_cpu() -> Option<CpuSample> {
    let stat = read("/proc/stat")?;
    let line = stat.lines().next()?;
    let vals: Vec<u64> = line
        .split_whitespace()
        .skip(1)
        .filter_map(|v| v.parse().ok())
        .collect();
    if vals.len() < 4 {
        return None;
    }
    let idle = vals[3] + vals.get(4).copied().unwrap_or(0);
    Some(CpuSample {
        idle,
        total: vals.iter().sum(),
    })
}

fn collect_system(cfg: &Config, cpu_usage: f64) -> System {
    let hostname = read("/proc/sys/kernel/hostname")
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    let kernel = read("/proc/sys/kernel/osrelease")
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    let uptime_secs = read("/proc/uptime")
        .and_then(|s| s.split_whitespace().next().and_then(|v| v.parse().ok()))
        .unwrap_or(0.0);

    let mut load_average = [0.0; 3];
    if let Some(s) = read("/proc/loadavg") {
        for (i, v) in s.split_whitespace().take(3).enumerate() {
            load_average[i] = v.parse().unwrap_or(0.0);
        }
    }

    let cpu_count = read("/proc/cpuinfo")
        .map(|s| s.lines().filter(|l| l.starts_with("processor")).count() as u32)
        .unwrap_or(1)
        .max(1);

    System {
        hostname,
        model: cfg.model.clone(),
        kernel,
        uptime_secs,
        load_average,
        cpu_count,
        cpu_usage_percent: cpu_usage,
        memory: collect_memory(),
        usb_storage: statvfs(&cfg.usb_mount),
    }
}

fn collect_memory() -> Memory {
    let mut m = Memory::default();
    let Some(info) = read("/proc/meminfo") else {
        return m;
    };
    let (mut free, mut buffers, mut cached, mut avail) = (0, 0, 0, None);
    for line in info.lines() {
        let mut parts = line.split_whitespace();
        let key = parts.next().unwrap_or("");
        let kb: u64 = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
        let bytes = kb * 1024;
        match key {
            "MemTotal:" => m.total_bytes = bytes,
            "MemFree:" => free = bytes,
            "MemAvailable:" => avail = Some(bytes),
            "Buffers:" => buffers = bytes,
            "Cached:" => cached = bytes,
            "SwapTotal:" => m.swap_total_bytes = bytes,
            "SwapFree:" => m.swap_free_bytes = bytes,
            _ => {}
        }
    }
    m.available_bytes = avail.unwrap_or(free + buffers + cached);
    m.used_bytes = m.total_bytes.saturating_sub(m.available_bytes);
    m.used_percent = pct(m.used_bytes, m.total_bytes);
    m.swap_used_percent = pct(
        m.swap_total_bytes.saturating_sub(m.swap_free_bytes),
        m.swap_total_bytes,
    );
    m
}

/// Only reports a mount that is actually mounted, so an unplugged stick does
/// not masquerade as the (tiny) overlay filesystem underneath it.
fn statvfs(mount: &str) -> Option<Storage> {
    let mounts = read("/proc/mounts").unwrap_or_default();
    if !mounts
        .lines()
        .any(|l| l.split_whitespace().nth(1) == Some(mount))
    {
        return None;
    }
    let path = std::ffi::CString::new(mount).ok()?;
    let mut st: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(path.as_ptr(), &mut st) } != 0 {
        return None;
    }
    let frsize = if st.f_frsize > 0 { st.f_frsize } else { st.f_bsize } as u64;
    let total = st.f_blocks as u64 * frsize;
    let free = st.f_bavail as u64 * frsize;
    let used = total.saturating_sub(st.f_bfree as u64 * frsize);
    Some(Storage {
        mount: mount.to_string(),
        total_bytes: total,
        free_bytes: free,
        used_bytes: used,
        used_percent: pct(used, used + free),
    })
}

/* ------------------------------------------------------------------ *
 * Multi-WAN (mwan3)
 * ------------------------------------------------------------------ */

fn link_up(device: &str) -> bool {
    read(&format!("/sys/class/net/{device}/operstate"))
        .map(|s| {
            let s = s.trim();
            // PPP devices report "unknown" while carrying traffic.
            s == "up" || s == "unknown"
        })
        .unwrap_or(false)
}

/// Single ICMP probe bound to the uplink device (busybox ping supports -I).
fn ping_latency(device: &str) -> Option<f64> {
    let out = run("ping", &["-c", "1", "-W", "1", "-I", device, "1.1.1.1"])?;
    let idx = out.find("time=")?;
    let rest = &out[idx + 5..];
    let end = rest.find(|c: char| !(c.is_ascii_digit() || c == '.'))?;
    rest[..end].parse().ok()
}

fn collect_multi_wan(cfg: &Config) -> MultiWan {
    let uplinks = [(&cfg.primary, "primary"), (&cfg.backup, "backup")];
    let mut ifaces: Vec<WanIface> = uplinks
        .iter()
        .map(|(u, role)| WanIface {
            name: u.iface.clone(),
            device: u.device.clone(),
            label: u.label.clone(),
            role,
            status: "unknown".into(),
            ..Default::default()
        })
        .collect();

    let mut source = "sysfs";
    let mut active = None;

    // `mwan3 status` lines look like:
    //   " interface wan is online 01h:23m:45s, uptime 12h:00m:01s and tracking is active"
    //   " interface wwan is offline and tracking is down"
    //   "wan (100%)"  under "Current ipv4 policies:"
    if let Some(status) = run("mwan3", &["interfaces"]).or_else(|| run("mwan3", &["status"])) {
        source = "mwan3";
        for line in status.lines() {
            let t = line.trim();
            if let Some(rest) = t.strip_prefix("interface ") {
                let mut words = rest.split_whitespace();
                let name = words.next().unwrap_or("");
                let _is = words.next();
                let state = words.next().unwrap_or("unknown");
                if let Some(w) = ifaces.iter_mut().find(|w| w.name == name) {
                    w.status = state.to_string();
                    w.online = state == "online";
                    w.uptime = rest
                        .split("uptime ")
                        .nth(1)
                        .and_then(|u| u.split_whitespace().next())
                        .map(|u| u.trim_end_matches(',').to_string());
                }
            }
        }
        if let Some(policies) = run("mwan3", &["policies"]) {
            active = policies
                .lines()
                .map(str::trim)
                .find(|l| l.contains("(100%)") || l.contains('%'))
                .and_then(|l| l.split_whitespace().next())
                .map(str::to_string);
        }
    }

    for w in ifaces.iter_mut() {
        if source == "sysfs" {
            w.online = link_up(&w.device);
            w.status = if w.online { "online" } else { "offline" }.into();
        }
        if w.online {
            w.latency_ms = ping_latency(&w.device);
        }
    }

    let primary_online = ifaces[0].online;
    let backup_online = ifaces[1].online;
    if active.is_none() {
        active = if primary_online {
            Some(ifaces[0].name.clone())
        } else if backup_online {
            Some(ifaces[1].name.clone())
        } else {
            None
        };
    }
    let failover = !primary_online && active.as_deref() == Some(ifaces[1].name.as_str());

    MultiWan {
        source: source.into(),
        interfaces: ifaces,
        active,
        failover,
    }
}

/* ------------------------------------------------------------------ *
 * ISP bandwidth (vnStat 2.x JSON)
 * ------------------------------------------------------------------ */

fn vnstat_latest(cfg: &Config, mode: &str) -> Option<serde_json::Value> {
    let out = run("vnstat", &["--dbdir", &cfg.vnstat_dbdir, "--json", mode, "1"])
        .or_else(|| run("vnstat", &["--json", mode, "1"]))?;
    serde_json::from_str(&out).ok()
}

fn vnstat_last(json: &serde_json::Value, iface: &str, key: &str) -> (u64, u64) {
    json["interfaces"]
        .as_array()
        .and_then(|list| list.iter().find(|i| i["name"] == iface))
        .and_then(|i| i["traffic"][key].as_array())
        .and_then(|rows| rows.last())
        .map(|r| (r["rx"].as_u64().unwrap_or(0), r["tx"].as_u64().unwrap_or(0)))
        .unwrap_or((0, 0))
}

fn collect_bandwidth(cfg: &Config) -> Vec<IspBandwidth> {
    let day = vnstat_latest(cfg, "d");
    let month = vnstat_latest(cfg, "m");
    if day.is_none() && month.is_none() {
        return Vec::new();
    }
    let null = serde_json::Value::Null;
    [(&cfg.primary, "primary"), (&cfg.backup, "backup")]
        .iter()
        .map(|(u, role)| {
            let (drx, dtx) = vnstat_last(day.as_ref().unwrap_or(&null), &u.device, "day");
            let (mrx, mtx) = vnstat_last(month.as_ref().unwrap_or(&null), &u.device, "month");
            IspBandwidth {
                interface: u.device.clone(),
                label: u.label.clone(),
                role,
                today_rx_bytes: drx,
                today_tx_bytes: dtx,
                month_rx_bytes: mrx,
                month_tx_bytes: mtx,
            }
        })
        .collect()
}

/* ------------------------------------------------------------------ *
 * Wi-Fi (iwinfo, falling back to /proc/net/wireless)
 * ------------------------------------------------------------------ */

fn collect_wifi() -> Wifi {
    let mut wifi = Wifi::default();
    if let Some(out) = run("iwinfo", &[]) {
        let mut current: Option<Radio> = None;
        for line in out.lines() {
            if !line.starts_with(' ') && !line.trim().is_empty() {
                if let Some(r) = current.take() {
                    wifi.radios.push(r);
                }
                let device = line.split_whitespace().next().unwrap_or("").to_string();
                let ssid = line
                    .split("ESSID: ")
                    .nth(1)
                    .map(|s| s.trim().trim_matches('"').to_string())
                    .unwrap_or_default();
                current = Some(Radio {
                    device,
                    ssid,
                    ..Default::default()
                });
            } else if let Some(r) = current.as_mut() {
                let t = line.trim();
                if let Some(m) = t.strip_prefix("Mode: ") {
                    r.mode = m.split_whitespace().next().unwrap_or("").to_string();
                    if let Some(ch) = t.split("Channel: ").nth(1) {
                        let mut it = ch.split_whitespace();
                        r.channel = it.next().and_then(|c| c.parse().ok());
                        r.frequency_ghz = it
                            .next()
                            .map(|f| f.trim_start_matches('('))
                            .and_then(|f| f.parse().ok());
                    }
                }
            }
        }
        if let Some(r) = current.take() {
            wifi.radios.push(r);
        }
        for r in wifi.radios.iter_mut().filter(|r| r.mode == "Master") {
            r.clients = run("iwinfo", &[&r.device, "assoclist"])
                .map(|s| {
                    s.lines()
                        .filter(|l| {
                            let b = l.as_bytes();
                            b.len() > 17 && b[2] == b':' && b[5] == b':'
                        })
                        .count() as u32
                })
                .unwrap_or(0);
        }
    } else if let Some(s) = read("/proc/net/wireless") {
        for line in s.lines().skip(2) {
            if let Some(dev) = line.split(':').next() {
                wifi.radios.push(Radio {
                    device: dev.trim().to_string(),
                    ..Default::default()
                });
            }
        }
    }
    wifi.total_clients = wifi.radios.iter().map(|r| r.clients).sum();
    wifi
}

/* ------------------------------------------------------------------ *
 * AdGuard Home (DNS on :53)
 * ------------------------------------------------------------------ */

/// True when /proc/net/{tcp,udp}[6] has a socket bound to local port 53
/// (0035) — TCP sockets must also be in LISTEN (0A) state.
fn port53_bound(table: &str, tcp: bool) -> bool {
    [table, &format!("{table}6")].iter().any(|t| {
        read(&format!("/proc/net/{t}"))
            .map(|s| {
                s.lines().skip(1).any(|l| {
                    let f: Vec<&str> = l.split_whitespace().collect();
                    f.len() > 3
                        && f[1].ends_with(":0035")
                        && (!tcp || f[3] == "0A")
                })
            })
            .unwrap_or(false)
    })
}

/// Sends a minimal A-record query for "example.com" and waits for any answer.
fn dns_responds() -> bool {
    let Ok(sock) = UdpSocket::bind("127.0.0.1:0") else {
        return false;
    };
    let _ = sock.set_read_timeout(Some(Duration::from_millis(800)));
    let query: [u8; 29] = [
        0x47, 0x44, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 7, b'e', b'x',
        b'a', b'm', b'p', b'l', b'e', 3, b'c', b'o', b'm', 0, 0x00, 0x01, 0x00, 0x01,
    ];
    if sock.send_to(&query, "127.0.0.1:53").is_err() {
        return false;
    }
    let mut buf = [0u8; 512];
    matches!(sock.recv_from(&mut buf), Ok((n, _)) if n >= 12 && buf[0] == 0x47 && buf[1] == 0x44)
}

fn collect_adguard() -> AdGuard {
    let port53_tcp = port53_bound("tcp", true)
        || TcpStream::connect_timeout(
            &SocketAddr::from(([127, 0, 0, 1], 53)),
            Duration::from_millis(300),
        )
        .is_ok();
    AdGuard {
        port53_tcp,
        port53_udp: port53_bound("udp", false),
        dns_responding: dns_responds(),
    }
}

/* ------------------------------------------------------------------ *
 * Sampler + HTTP server
 * ------------------------------------------------------------------ */

/// Bandwidth and Wi-Fi spawn processes, so they refresh on a slower cadence.
const SLOW_EVERY: Duration = Duration::from_secs(30);

fn sampler(cfg: Config, snapshot: Arc<RwLock<Vec<u8>>>) {
    let mut prev_cpu = read_cpu();
    let mut slow_at: Option<Instant> = None;
    let mut bandwidth = Vec::new();
    let mut wifi = Wifi::default();
    loop {
        let cur = read_cpu();
        let cpu_usage = match (&prev_cpu, &cur) {
            (Some(a), Some(b)) if b.total > a.total => {
                let total = (b.total - a.total) as f64;
                let idle = b.idle.saturating_sub(a.idle) as f64;
                ((1.0 - idle / total) * 1000.0).round() / 10.0
            }
            _ => 0.0,
        };
        prev_cpu = cur;

        if slow_at.map_or(true, |t| t.elapsed() >= SLOW_EVERY) {
            bandwidth = collect_bandwidth(&cfg);
            wifi = collect_wifi();
            slow_at = Some(Instant::now());
        }

        let t = Telemetry {
            timestamp: now_ms(),
            version: env!("CARGO_PKG_VERSION"),
            system: collect_system(&cfg, cpu_usage),
            multi_wan: collect_multi_wan(&cfg),
            isp_bandwidth: bandwidth.clone(),
            wifi: wifi.clone(),
            adguard: collect_adguard(),
        };
        if let Ok(body) = serde_json::to_vec(&t) {
            if let Ok(mut s) = snapshot.write() {
                *s = body;
            }
        }
        thread::sleep(Duration::from_secs(cfg.sample_secs));
    }
}

const CORS: &str = "Access-Control-Allow-Origin: *\r\n\
Access-Control-Allow-Methods: GET, OPTIONS\r\n\
Access-Control-Allow-Headers: Content-Type\r\n";

fn respond(stream: &mut TcpStream, status: &str, ctype: &str, body: &[u8]) {
    let head = format!(
        "HTTP/1.1 {status}\r\n{CORS}Content-Type: {ctype}\r\nContent-Length: {}\r\n\
         Cache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

fn handle(mut stream: TcpStream, snapshot: &RwLock<Vec<u8>>) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
    let mut buf = [0u8; 1024];
    let n = match stream.read(&mut buf) {
        Ok(n) if n > 0 => n,
        _ => return,
    };
    let req = String::from_utf8_lossy(&buf[..n]);
    let mut first = req.lines().next().unwrap_or("").split_whitespace();
    let method = first.next().unwrap_or("");
    let path = first.next().unwrap_or("").split('?').next().unwrap_or("");

    match (method, path) {
        ("OPTIONS", _) => respond(&mut stream, "204 No Content", "text/plain", b""),
        ("GET", "/api/telemetry") => {
            let body = snapshot.read().map(|s| s.clone()).unwrap_or_default();
            if body.is_empty() {
                respond(
                    &mut stream,
                    "503 Service Unavailable",
                    "application/json",
                    br#"{"error":"warming up"}"#,
                );
            } else {
                respond(&mut stream, "200 OK", "application/json", &body);
            }
        }
        ("GET", "/health") => respond(&mut stream, "200 OK", "text/plain", b"ok"),
        _ => respond(
            &mut stream,
            "404 Not Found",
            "application/json",
            br#"{"error":"not found"}"#,
        ),
    }
}

fn main() {
    let cfg = Config::from_args();
    let snapshot = Arc::new(RwLock::new(Vec::new()));

    {
        let cfg = cfg.clone();
        let snap = Arc::clone(&snapshot);
        thread::Builder::new()
            .name("sampler".into())
            .stack_size(512 * 1024)
            .spawn(move || sampler(cfg, snap))
            .expect("spawn sampler");
    }

    let listener = match TcpListener::bind(("0.0.0.0", cfg.port)) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("router-telemetry: bind 0.0.0.0:{} failed: {e}", cfg.port);
            std::process::exit(1);
        }
    };
    eprintln!("router-telemetry listening on 0.0.0.0:{}", cfg.port);

    // Requests are a memcpy of a ready buffer, so serial handling is ample and
    // keeps memory flat regardless of client count.
    for stream in listener.incoming().flatten() {
        handle(stream, &snapshot);
    }
}
