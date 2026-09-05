import { BatteryFull, BatteryWarning, Plug, PlugZap, Gauge, HardDrive, Activity } from 'lucide-react';
import { HostTelemetry } from '../../types/dashboard';
import { formatRate, cn } from '../../lib/utils';

interface Props {
  host?: HostTelemetry;
}

/*
 * Three signals that each answer a question the existing tiles cannot.
 *
 *  - Power: on a laptop-turned-server the battery is a built-in UPS. Losing
 *    mains is silent otherwise -- everything keeps running until it doesn't.
 *  - Throttle: temperature is a lagging signal. These counters are monotonic,
 *    so a rise is proof the CPU actually dropped clocks between samples.
 *  - Disk I/O: the host already charts I/O wait but not which device caused
 *    it, which is the part you need to act on.
 *
 * Each block renders only when the host actually reports it, so machines
 * without a battery or without diskstats simply show less rather than showing
 * zeroes that look like broken sensors.
 */
export function SystemHealthStrip({ host }: Props) {
  if (!host) return null;
  const { battery, throttle, diskIo, pressure } = host;
  const busyDisks = (diskIo ?? []).filter((d) => d.utilPercent > 0 || d.readBytesPerSec + d.writeBytesPerSec > 0);
  /*
   * Pressure only earns a tile once something is actually stalling. A box that
   * is genuinely idle would otherwise get a permanent row of zeroes, which is
   * exactly the kind of decoration that trains you to stop reading the strip.
   */
  const stalling =
    pressure &&
    Math.max(pressure.cpu?.some10 ?? 0, pressure.io?.some10 ?? 0, pressure.memory?.some10 ?? 0) >= 1;
  if (!battery && !throttle && busyDisks.length === 0 && !stalling) return null;

  const onBattery = battery?.present && !battery.onMains;
  const throttled = throttle?.throttlingNow;
  const everThrottled = (throttle?.coreEvents ?? 0) + (throttle?.packageEvents ?? 0) > 0;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {battery && (
        <div className={cn('surface p-3.5', onBattery && 'border-crit/50')}>
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-2xs uppercase tracking-wide text-muted-foreground">
              {onBattery ? <PlugZap className="h-3.5 w-3.5 text-crit" /> : <Plug className="h-3.5 w-3.5 text-ok" />}
              Power
            </span>
            <span className={cn('font-mono text-xs font-semibold', onBattery ? 'text-crit' : 'text-ok')}>
              {onBattery ? 'ON BATTERY' : 'Mains'}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            {battery.present ? (
              onBattery ? (
                <BatteryWarning className="h-4 w-4 text-crit" />
              ) : (
                <BatteryFull className="h-4 w-4 text-muted-foreground" />
              )
            ) : null}
            <span className="text-sm font-medium text-foreground">
              {battery.present ? `${battery.chargePercent ?? '--'}%` : 'No battery'}
            </span>
            <span className="truncate text-2xs text-muted-foreground">
              {battery.status}
              {battery.minutesRemaining !== undefined && ` - ~${battery.minutesRemaining} min left`}
              {battery.cycleCount !== undefined && battery.cycleCount > 0 && ` - ${battery.cycleCount} cycles`}
            </span>
          </div>
          {battery.present && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn('h-full rounded-full transition-all duration-500', onBattery ? 'bg-crit' : 'bg-ok')}
                style={{ width: `${Math.min(100, Math.max(0, battery.chargePercent ?? 0))}%` }}
              />
            </div>
          )}
        </div>
      )}

      {throttle && (
        <div className={cn('surface p-3.5', throttled && 'border-crit/50')}>
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-2xs uppercase tracking-wide text-muted-foreground">
              <Gauge className={cn('h-3.5 w-3.5', throttled ? 'text-crit' : 'text-muted-foreground')} />
              CPU Throttle
            </span>
            <span
              className={cn(
                'font-mono text-xs font-semibold',
                throttled ? 'text-crit' : everThrottled ? 'text-warn' : 'text-ok'
              )}
            >
              {throttled ? 'THROTTLING' : everThrottled ? 'Recovered' : 'Clear'}
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-sm font-medium text-foreground">
              {throttle.currentMhz ?? '--'}
              <span className="text-2xs text-muted-foreground">
                {throttle.maxMhz ? ` / ${throttle.maxMhz} MHz` : ' MHz'}
              </span>
            </span>
          </div>
          <div className="mt-1 text-2xs text-muted-foreground">
            {throttle.coreEvents} core / {throttle.packageEvents} package events since boot
          </div>
        </div>
      )}

      {stalling && pressure && (
        <div
          className={cn(
            'surface p-3.5',
            (pressure.memory?.some10 ?? 0) >= 10 && 'border-crit/50'
          )}
        >
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-2xs uppercase tracking-wide text-muted-foreground">
              <Activity className="h-3.5 w-3.5" />
              Stall Pressure
            </span>
            <span className="font-mono text-2xs text-muted-foreground">avg10 / avg60</span>
          </div>
          <div className="mt-2 space-y-1.5">
            {([
              ['io', pressure.io, 'Tasks blocked on disk'],
              ['memory', pressure.memory, 'Tasks blocked reclaiming memory'],
              ['cpu', pressure.cpu, 'Tasks waiting for a runnable CPU'],
            ] as const).map(([label, metric, title]) =>
              metric ? (
                <div key={label} className="flex items-center justify-between gap-2 text-2xs" title={title}>
                  <span className="font-mono text-foreground">{label}</span>
                  <span
                    className={cn(
                      'shrink-0 font-mono font-semibold',
                      metric.some10 >= 20 ? 'text-crit' : metric.some10 >= 5 ? 'text-warn' : 'text-muted-foreground'
                    )}
                  >
                    {metric.some10.toFixed(1)}% / {metric.some60.toFixed(1)}%
                  </span>
                </div>
              ) : null
            )}
          </div>
          <div className="mt-1.5 text-2xs text-muted-foreground">
            Share of time at least one task was stalled.
          </div>
        </div>
      )}

      {busyDisks.length > 0 && (
        <div className="surface p-3.5">
          <span className="inline-flex items-center gap-1.5 text-2xs uppercase tracking-wide text-muted-foreground">
            <HardDrive className="h-3.5 w-3.5" />
            Disk I/O
          </span>
          <div className="mt-2 space-y-1.5">
            {busyDisks.slice(0, 3).map((d) => (
              <div key={d.device} className="flex items-center justify-between gap-2 text-2xs">
                <span className="font-mono text-foreground">{d.device}</span>
                <span className="truncate text-muted-foreground">
                  ↓{formatRate(d.readBytesPerSec)} ↑{formatRate(d.writeBytesPerSec)}
                </span>
                <span
                  className={cn(
                    'shrink-0 font-mono font-semibold',
                    d.utilPercent > 90 ? 'text-crit' : d.utilPercent > 60 ? 'text-warn' : 'text-muted-foreground'
                  )}
                >
                  {d.utilPercent}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
