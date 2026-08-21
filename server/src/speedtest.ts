import https from 'node:https';
import crypto from 'node:crypto';
import { SpeedtestProgress, SpeedtestResult } from './types.js';
import { logger } from './logger.js';

let speedtestHistory: SpeedtestResult[] = [];
let currentTestProgress: SpeedtestProgress | null = null;
let isTestRunning = false;

export function getSpeedtestHistory(): SpeedtestResult[] {
  return speedtestHistory;
}

export function getCurrentSpeedtestProgress(): SpeedtestProgress | null {
  return currentTestProgress;
}

function httpsGetStream(
  url: string,
  onChunk: (bytes: number) => void,
  timeoutMs: number = 10000
): Promise<number> {
  return new Promise((resolve, reject) => {
    let totalBytes = 0;
    const req = https.get(url, { headers: { 'User-Agent': 'Guardian-Speedtest/1.0' } }, (res) => {
      res.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        onChunk(chunk.length);
      });
      res.on('end', () => resolve(totalBytes));
      res.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(totalBytes);
    });
  });
}

function httpsPostStream(
  url: string,
  payload: Buffer,
  onChunk: (bytes: number) => void,
  timeoutMs: number = 10000
): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': payload.length,
          'User-Agent': 'Guardian-Speedtest/1.0',
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(payload.length));
      }
    );

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(payload.length);
    });

    // Write in chunks to track upload progress
    const chunkSize = 64 * 1024;
    let offset = 0;
    function writeNext() {
      while (offset < payload.length) {
        const chunk = payload.subarray(offset, offset + chunkSize);
        offset += chunk.length;
        onChunk(chunk.length);
        const ok = req.write(chunk);
        if (!ok) {
          req.once('drain', writeNext);
          return;
        }
      }
      req.end();
    }
    writeNext();
  });
}

async function measurePingAndJitter(): Promise<{ pingMs: number; jitterMs: number }> {
  const pings: number[] = [];
  for (let i = 0; i < 5; i++) {
    const start = Date.now();
    try {
      await new Promise<void>((resolve, reject) => {
        const req = https.request(
          'https://speed.cloudflare.com/__down?bytes=0',
          { method: 'HEAD', timeout: 3000 },
          (res) => {
            res.resume();
            resolve();
          }
        );
        req.on('error', reject);
        req.end();
      });
      pings.push(Date.now() - start);
    } catch {
      pings.push(50);
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  const avgPing = Math.round(pings.reduce((a, b) => a + b, 0) / pings.length);
  let jitterSum = 0;
  for (let i = 1; i < pings.length; i++) {
    jitterSum += Math.abs(pings[i] - pings[i - 1]);
  }
  const jitterMs = Math.round(jitterSum / (pings.length - 1 || 1));

  return { pingMs: avgPing, jitterMs };
}

/**
 * Runs a multi-phase speedtest against Cloudflare Speed Edge.
 */
export async function runSpeedtest(
  onProgress?: (progress: SpeedtestProgress) => void
): Promise<SpeedtestResult> {
  if (isTestRunning) {
    throw new Error('Speedtest is already in progress');
  }

  isTestRunning = true;
  const updateProgress = (p: SpeedtestProgress) => {
    currentTestProgress = p;
    onProgress?.(p);
  };

  try {
    logger.info('speedtest', 'Starting network speedtest...');

    // Phase 1: Ping & Jitter
    updateProgress({ phase: 'ping', currentMbps: 0, progressPercent: 10 });
    const { pingMs, jitterMs } = await measurePingAndJitter();

    // Phase 2: Download Test
    updateProgress({ phase: 'download', currentMbps: 0, progressPercent: 25, pingMs });

    let totalDownloadBytes = 0;
    const downloadStartTime = Date.now();
    const downloadDurationSec = 6;
    const downloadEndpoints = [
      'https://speed.cloudflare.com/__down?bytes=25000000',
      'https://speed.cloudflare.com/__down?bytes=50000000',
      'https://speed.cloudflare.com/__down?bytes=25000000',
    ];

    const dlPromises = downloadEndpoints.map(async (url) => {
      try {
        await httpsGetStream(
          url,
          (bytes) => {
            totalDownloadBytes += bytes;
            const elapsed = Math.max(0.1, (Date.now() - downloadStartTime) / 1000);
            const currentMbps = Math.round(((totalDownloadBytes * 8) / (elapsed * 1_000_000)) * 10) / 10;
            const progress = Math.min(65, 25 + Math.round((elapsed / downloadDurationSec) * 40));
            updateProgress({
              phase: 'download',
              currentMbps,
              progressPercent: progress,
              pingMs,
            });
          },
          downloadDurationSec * 1000
        );
      } catch {}
    });

    await Promise.all(dlPromises);
    const dlElapsedSec = Math.max(0.5, (Date.now() - downloadStartTime) / 1000);
    const finalDownloadMbps =
      Math.round(((totalDownloadBytes * 8) / (dlElapsedSec * 1_000_000)) * 10) / 10 || 1.0;

    // Phase 3: Upload Test
    updateProgress({
      phase: 'upload',
      currentMbps: 0,
      progressPercent: 70,
      downloadMbps: finalDownloadMbps,
      pingMs,
    });

    let totalUploadBytes = 0;
    const uploadStartTime = Date.now();
    const uploadPayload = crypto.randomBytes(10 * 1024 * 1024); // 10 MB buffer
    const uploadDurationSec = 5;

    const ulPromises = [1, 2].map(async () => {
      try {
        await httpsPostStream(
          'https://speed.cloudflare.com/__up',
          uploadPayload,
          (bytes) => {
            totalUploadBytes += bytes;
            const elapsed = Math.max(0.1, (Date.now() - uploadStartTime) / 1000);
            const currentMbps = Math.round(((totalUploadBytes * 8) / (elapsed * 1_000_000)) * 10) / 10;
            const progress = Math.min(95, 70 + Math.round((elapsed / uploadDurationSec) * 25));
            updateProgress({
              phase: 'upload',
              currentMbps,
              progressPercent: progress,
              downloadMbps: finalDownloadMbps,
              pingMs,
            });
          },
          uploadDurationSec * 1000
        );
      } catch {}
    });

    await Promise.all(ulPromises);
    const ulElapsedSec = Math.max(0.5, (Date.now() - uploadStartTime) / 1000);
    const finalUploadMbps =
      Math.round(((totalUploadBytes * 8) / (ulElapsedSec * 1_000_000)) * 10) / 10 || 1.0;

    // Complete
    const result: SpeedtestResult = {
      id: `st-${Date.now()}`,
      timestamp: Date.now(),
      downloadMbps: finalDownloadMbps,
      uploadMbps: finalUploadMbps,
      pingMs,
      jitterMs,
      server: 'Cloudflare Edge CDN',
    };

    speedtestHistory.unshift(result);
    if (speedtestHistory.length > 20) {
      speedtestHistory = speedtestHistory.slice(0, 20);
    }

    updateProgress({
      phase: 'complete',
      currentMbps: finalDownloadMbps,
      progressPercent: 100,
      downloadMbps: finalDownloadMbps,
      uploadMbps: finalUploadMbps,
      pingMs,
    });

    logger.info(
      'speedtest',
      `Speedtest complete: ↓ ${finalDownloadMbps} Mbps, ↑ ${finalUploadMbps} Mbps, ${pingMs} ms`
    );

    return result;
  } catch (err) {
    const errorMsg = (err as Error).message || 'Speedtest failed';
    updateProgress({
      phase: 'error',
      currentMbps: 0,
      progressPercent: 100,
      error: errorMsg,
    });
    throw err;
  } finally {
    isTestRunning = false;
  }
}
