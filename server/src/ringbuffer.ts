import { HistoryPoint } from './types.js';

export class TelemetryRingBuffer {
  private buffer: HistoryPoint[] = [];
  private maxPoints: number;

  constructor(maxPoints: number = 60) {
    this.maxPoints = maxPoints;
  }

  public push(point: HistoryPoint): void {
    this.buffer.push(point);
    if (this.buffer.length > this.maxPoints) {
      this.buffer.shift();
    }
  }

  public getHistory(): HistoryPoint[] {
    return [...this.buffer];
  }
}

export const globalHistory = new TelemetryRingBuffer(120); // 30 minutes at 15s intervals
