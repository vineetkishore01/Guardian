# router-telemetry

Ultra-low-memory, zero-NAND-wear telemetry daemon for OpenWrt (MediaTek MT7621AT / ASUS RT-AX53U) designed for [Guardian](https://github.com/vineetkishore01/Guardian).

## Architectural Principles & Invariants

1. **Zero NAND Flash Wear**:
   - The router's 128 MB internal NAND flash is never written to.
   - The binary resides exclusively on external USB storage (`/mnt/usb/telemetry/bin/router-telemetry`).
   - Logging to disk is disabled (`procd_set_param stdout 0`, `procd_set_param stderr 0`).
   - Runtime metrics are computed in memory or read from Linux sysfs/procfs and tmpfs.
2. **Minimal Resource Footprint**:
   - Written in pure Rust (`std::net`, `serde`, `serde_json`, `libc`).
   - Steady-state memory footprint: **~1.68 MB RSS** (target was < 2 MB).
   - CPU utilization: **0.0%** steady-state.
   - Dual-thread design: a background sampler refreshes an in-memory JSON snapshot every 5s; the HTTP server loop simply copies the pre-built buffer to incoming sockets without reparsing `/proc` or spawning child processes.
3. **MIPS Soft-Float ABI Compatibility**:
   - MediaTek MT7621AT (MIPS 1004Kc) lacks a hardware Floating Point Unit (FPU), and OpenWrt ramips does not emulate FPU instructions in kernel space. Standard `mipsel-unknown-linux-musl` binaries that execute hard-float instructions (`lwc1`, `swc1`, `sub.d`, etc.) trigger `SIGILL (Exit code 132)`.
   - The daemon standard library and binary are cross-compiled using `-Z build-std=std,panic_abort` and `mipsel-linux-muslsf-cross` from `musl.cc` with `Tag_GNU_MIPS_ABI_FP: Soft float`.

## Cross-Compilation Instructions

```bash
# 1. Download musl soft-float toolchain
curl -sL https://musl.cc/mipsel-linux-muslsf-cross.tgz | tar -xz -C /tmp/

# 2. Build via nightly with build-std
docker run --rm \
  -v /tmp/mipsel-linux-muslsf-cross:/opt/toolchain:ro \
  -v $(pwd):/work \
  -w /work \
  -e PATH="/opt/toolchain/bin:/usr/local/cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  rust:slim \
  bash -c 'rustup toolchain install nightly && \
           rustup component add rust-src --toolchain nightly && \
           cargo +nightly build --release --target mipsel-unknown-linux-musl -Z build-std=std,panic_abort'

# 3. Strip symbols
/tmp/mipsel-linux-muslsf-cross/bin/mipsel-linux-muslsf-strip target/mipsel-unknown-linux-musl/release/router-telemetry
```

## Procd Service (`/etc/init.d/router-telemetry`)

```sh
#!/bin/sh /etc/rc.common

START=95
STOP=10
USE_PROCD=1

PROG=/mnt/usb/telemetry/bin/router-telemetry

start_service() {
    [ -x "$PROG" ] || return 1
    procd_open_instance
    procd_set_param command "$PROG" \
        --port 9191 \
        --model "ASUS RT-AX53U" \
        --usb-mount "/mnt/usb" \
        --vnstat-dbdir "/mnt/usb/vnstat" \
        --primary-iface "wan" \
        --primary-dev "pppoe-wan" \
        --primary-label "ACT Fibernet" \
        --backup-iface "wan2" \
        --backup-dev "phy0-sta0" \
        --backup-label "Neighbor Wi-Fi" \
        --interval 5
    procd_set_param respawn 3600 5 0
    procd_set_param stdout 0
    procd_set_param stderr 0
    procd_close_instance
}

stop_service() {
    killall -9 router-telemetry 2>/dev/null
}
```
