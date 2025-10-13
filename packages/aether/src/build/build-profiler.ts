/**
 * Build Profiling and Reporting
 * Detailed performance metrics and reporting for build analysis
 */

import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Configuration for build profiler
 */
export interface BuildProfilerConfig {
  /**
   * Enable profiling
   * @default true
   */
  enabled?: boolean;

  /**
   * Output directory for reports
   * @default '.aether/profiler'
   */
  outputDir?: string;

  /**
   * Report format
   * @default 'all'
   */
  format?: 'html' | 'json' | 'table' | 'all';

  /**
   * Detail level
   * @default 'normal'
   */
  details?: 'minimal' | 'normal' | 'detailed';

  /**
   * Open report in browser
   * @default false
   */
  open?: boolean;

  /**
   * Threshold for slow operations (in ms)
   * @default 100
   */
  slowThreshold?: number;

  /**
   * Whether to track memory usage
   * @default true
   */
  trackMemory?: boolean;

  /**
   * Whether to generate flamegraph
   * @default false
   */
  generateFlamegraph?: boolean;
}

/**
 * Performance metric entry
 */
export interface MetricEntry {
  /** Metric name */
  name: string;
  /** Start time in ms */
  startTime: number;
  /** End time in ms */
  endTime?: number;
  /** Duration in ms */
  duration?: number;
  /** Parent metric */
  parent?: string;
  /** Metadata */
  metadata?: Record<string, any>;
  /** Memory usage at start */
  memoryStart?: number;
  /** Memory usage at end */
  memoryEnd?: number;
  /** Memory delta */
  memoryDelta?: number;
}

/**
 * Module compilation metric
 */
export interface ModuleMetric {
  /** Module ID */
  id: string;
  /** Compilation time in ms */
  compilationTime: number;
  /** Transform time in ms */
  transformTime: number;
  /** Size in bytes */
  size: number;
  /** Dependencies count */
  dependencies: number;
  /** Timestamp */
  timestamp: number;
}

/**
 * Plugin execution metric
 */
export interface PluginMetric {
  /** Plugin name */
  name: string;
  /** Hook name */
  hook: string;
  /** Execution time in ms */
  executionTime: number;
  /** Call count */
  callCount: number;
  /** Total time in ms */
  totalTime: number;
}

/**
 * Build phase metric
 */
export interface PhaseMetric {
  /** Phase name */
  name: string;
  /** Duration in ms */
  duration: number;
  /** Percentage of total time */
  percentage: number;
  /** Sub-phases */
  subPhases?: PhaseMetric[];
}

/**
 * Performance report
 */
export interface PerformanceReport {
  /** Build timestamp */
  timestamp: number;
  /** Total build time in ms */
  totalTime: number;
  /** Phases breakdown */
  phases: PhaseMetric[];
  /** Module metrics */
  modules: ModuleMetric[];
  /** Plugin metrics */
  plugins: PluginMetric[];
  /** Slow operations */
  slowOperations: MetricEntry[];
  /** Memory usage */
  memory?: {
    initial: number;
    peak: number;
    final: number;
    delta: number;
  };
  /** Summary statistics */
  summary: {
    totalModules: number;
    averageModuleTime: number;
    slowestModule: string;
    slowestModuleTime: number;
    totalPluginTime: number;
    cacheHitRate?: number;
  };
}

/**
 * Build profiler implementation
 */
export class BuildProfiler {
  private config: Required<BuildProfilerConfig>;
  private metrics: Map<string, MetricEntry> = new Map();
  private moduleMetrics: ModuleMetric[] = [];
  private pluginMetrics: Map<string, PluginMetric> = new Map();
  private startTime: number = 0;
  private activeMetrics: Set<string> = new Set();
  private memoryBaseline: number = 0;
  private memoryPeak: number = 0;

  constructor(config: BuildProfilerConfig = {}) {
    this.config = {
      enabled: config.enabled !== false,
      outputDir: config.outputDir || '.aether/profiler',
      format: config.format || 'all',
      details: config.details || 'normal',
      open: config.open || false,
      slowThreshold: config.slowThreshold || 100,
      trackMemory: config.trackMemory !== false,
      generateFlamegraph: config.generateFlamegraph || false,
    };
  }

  /**
   * Start profiling
   */
  start(): void {
    if (!this.config.enabled) return;

    this.startTime = performance.now();
    this.metrics.clear();
    this.moduleMetrics = [];
    this.pluginMetrics.clear();
    this.activeMetrics.clear();

    if (this.config.trackMemory) {
      this.memoryBaseline = this.getMemoryUsage();
      this.memoryPeak = this.memoryBaseline;
    }
  }

  /**
   * Start a metric
   */
  startMetric(name: string, parent?: string, metadata?: Record<string, any>): void {
    if (!this.config.enabled) return;

    const entry: MetricEntry = {
      name,
      startTime: performance.now(),
      parent,
      metadata,
    };

    if (this.config.trackMemory) {
      entry.memoryStart = this.getMemoryUsage();
    }

    this.metrics.set(name, entry);
    this.activeMetrics.add(name);
  }

  /**
   * End a metric
   */
  endMetric(name: string): void {
    if (!this.config.enabled) return;

    const entry = this.metrics.get(name);
    if (!entry) return;

    entry.endTime = performance.now();
    entry.duration = entry.endTime - entry.startTime;

    if (this.config.trackMemory) {
      entry.memoryEnd = this.getMemoryUsage();
      entry.memoryDelta = entry.memoryEnd - (entry.memoryStart || 0);

      if (entry.memoryEnd > this.memoryPeak) {
        this.memoryPeak = entry.memoryEnd;
      }
    }

    this.activeMetrics.delete(name);
  }

  /**
   * Record module compilation
   */
  recordModule(id: string, compilationTime: number, transformTime: number, size: number, dependencies: number): void {
    if (!this.config.enabled) return;

    this.moduleMetrics.push({
      id,
      compilationTime,
      transformTime,
      size,
      dependencies,
      timestamp: performance.now(),
    });
  }

  /**
   * Record plugin execution
   */
  recordPlugin(name: string, hook: string, executionTime: number): void {
    if (!this.config.enabled) return;

    const key = `${name}:${hook}`;
    const existing = this.pluginMetrics.get(key);

    if (existing) {
      existing.callCount++;
      existing.totalTime += executionTime;
    } else {
      this.pluginMetrics.set(key, {
        name,
        hook,
        executionTime,
        callCount: 1,
        totalTime: executionTime,
      });
    }
  }

  /**
   * Generate performance report
   */
  async generateReport(): Promise<PerformanceReport> {
    if (!this.config.enabled) {
      throw new Error('Profiler is not enabled');
    }

    const totalTime = performance.now() - this.startTime;
    const phases = this.calculatePhases(totalTime);
    const slowOperations = this.findSlowOperations();

    const sortedModules = [...this.moduleMetrics].sort((a, b) => b.compilationTime - a.compilationTime);

    const slowestModule = sortedModules[0];
    const avgModuleTime =
      this.moduleMetrics.length > 0
        ? this.moduleMetrics.reduce((sum, m) => sum + m.compilationTime, 0) / this.moduleMetrics.length
        : 0;

    const totalPluginTime = Array.from(this.pluginMetrics.values()).reduce((sum, p) => sum + p.totalTime, 0);

    const report: PerformanceReport = {
      timestamp: Date.now(),
      totalTime,
      phases,
      modules: sortedModules,
      plugins: Array.from(this.pluginMetrics.values()).sort((a, b) => b.totalTime - a.totalTime),
      slowOperations,
      summary: {
        totalModules: this.moduleMetrics.length,
        averageModuleTime: avgModuleTime,
        slowestModule: slowestModule?.id || 'none',
        slowestModuleTime: slowestModule?.compilationTime || 0,
        totalPluginTime,
      },
    };

    if (this.config.trackMemory) {
      report.memory = {
        initial: this.memoryBaseline,
        peak: this.memoryPeak,
        final: this.getMemoryUsage(),
        delta: this.getMemoryUsage() - this.memoryBaseline,
      };
    }

    return report;
  }

  /**
   * Save report to disk
   */
  async saveReport(report: PerformanceReport): Promise<void> {
    if (!this.config.enabled) return;

    await fs.mkdir(this.config.outputDir, { recursive: true });

    const formats = this.config.format === 'all' ? ['html', 'json', 'table'] : [this.config.format];

    for (const format of formats) {
      const content = await this.formatReport(report, format as any);
      const filename = `build-profile-${Date.now()}.${format === 'table' ? 'txt' : format}`;
      const filepath = path.join(this.config.outputDir, filename);

      await fs.writeFile(filepath, content, 'utf-8');

      if (format === 'html' && this.config.open) {
        await this.openInBrowser(filepath);
      }
    }

    if (this.config.generateFlamegraph) {
      await this.generateFlamegraphData(report);
    }
  }

  /**
   * Get current statistics
   */
  getStats(): {
    activeMetrics: number;
    totalMetrics: number;
    moduleCount: number;
    pluginCount: number;
    elapsedTime: number;
  } {
    return {
      activeMetrics: this.activeMetrics.size,
      totalMetrics: this.metrics.size,
      moduleCount: this.moduleMetrics.length,
      pluginCount: this.pluginMetrics.size,
      elapsedTime: performance.now() - this.startTime,
    };
  }

  /**
   * Clear profiling data
   */
  clear(): void {
    this.metrics.clear();
    this.moduleMetrics = [];
    this.pluginMetrics.clear();
    this.activeMetrics.clear();
  }

  /**
   * Calculate phase metrics
   */
  private calculatePhases(totalTime: number): PhaseMetric[] {
    const phases: PhaseMetric[] = [];

    // Group metrics by phase
    const phaseGroups = new Map<string, MetricEntry[]>();

    for (const [name, entry] of this.metrics) {
      if (!entry.duration) continue;

      const phaseName = entry.parent || 'root';
      if (!phaseGroups.has(phaseName)) {
        phaseGroups.set(phaseName, []);
      }
      phaseGroups.get(phaseName)!.push(entry);
    }

    // Calculate phase durations
    for (const [phaseName, entries] of phaseGroups) {
      const duration = entries.reduce((sum, e) => sum + (e.duration || 0), 0);
      const percentage = totalTime > 0 ? (duration / totalTime) * 100 : 0;

      phases.push({
        name: phaseName,
        duration,
        percentage,
      });
    }

    return phases.sort((a, b) => b.duration - a.duration);
  }

  /**
   * Find slow operations
   */
  private findSlowOperations(): MetricEntry[] {
    const slow: MetricEntry[] = [];

    for (const entry of this.metrics.values()) {
      if (entry.duration && entry.duration >= this.config.slowThreshold) {
        slow.push({ ...entry });
      }
    }

    return slow.sort((a, b) => (b.duration || 0) - (a.duration || 0));
  }

  /**
   * Format report
   */
  private async formatReport(report: PerformanceReport, format: 'html' | 'json' | 'table'): Promise<string> {
    if (format === 'json') {
      return JSON.stringify(report, null, 2);
    } else if (format === 'table') {
      return this.generateTableReport(report);
    } else {
      return this.generateHTMLReport(report);
    }
  }

  /**
   * Generate table report
   */
  private generateTableReport(report: PerformanceReport): string {
    let output = '';

    output += '='.repeat(80) + '\n';
    output += 'BUILD PERFORMANCE REPORT\n';
    output += '='.repeat(80) + '\n\n';

    output += `Total Build Time: ${report.totalTime.toFixed(2)}ms\n`;
    output += `Timestamp: ${new Date(report.timestamp).toISOString()}\n\n`;

    // Phases
    output += 'BUILD PHASES:\n';
    output += '-'.repeat(80) + '\n';
    for (const phase of report.phases) {
      output += `${phase.name.padEnd(30)} ${phase.duration.toFixed(2).padStart(10)}ms  ${phase.percentage.toFixed(1).padStart(5)}%\n`;
    }
    output += '\n';

    // Top modules
    output += 'TOP 10 SLOWEST MODULES:\n';
    output += '-'.repeat(80) + '\n';
    const topModules = report.modules.slice(0, 10);
    for (const module of topModules) {
      output += `${module.id.padEnd(50)} ${module.compilationTime.toFixed(2).padStart(10)}ms\n`;
    }
    output += '\n';

    // Plugins
    if (report.plugins.length > 0) {
      output += 'PLUGIN EXECUTION TIMES:\n';
      output += '-'.repeat(80) + '\n';
      for (const plugin of report.plugins.slice(0, 10)) {
        output += `${plugin.name.padEnd(30)} ${plugin.hook.padEnd(20)} ${plugin.totalTime.toFixed(2).padStart(10)}ms (${plugin.callCount}x)\n`;
      }
      output += '\n';
    }

    // Summary
    output += 'SUMMARY:\n';
    output += '-'.repeat(80) + '\n';
    output += `Total Modules: ${report.summary.totalModules}\n`;
    output += `Average Module Time: ${report.summary.averageModuleTime.toFixed(2)}ms\n`;
    output += `Slowest Module: ${report.summary.slowestModule} (${report.summary.slowestModuleTime.toFixed(2)}ms)\n`;
    output += `Total Plugin Time: ${report.summary.totalPluginTime.toFixed(2)}ms\n`;

    if (report.memory) {
      output += `\nMEMORY:\n`;
      output += `-`.repeat(80) + '\n';
      output += `Initial: ${this.formatBytes(report.memory.initial)}\n`;
      output += `Peak: ${this.formatBytes(report.memory.peak)}\n`;
      output += `Final: ${this.formatBytes(report.memory.final)}\n`;
      output += `Delta: ${this.formatBytes(report.memory.delta)}\n`;
    }

    return output;
  }

  /**
   * Generate HTML report
   */
  private generateHTMLReport(report: PerformanceReport): string {
    const phaseChart = this.generatePhaseChart(report.phases);
    const moduleTable = this.generateModuleTable(report.modules.slice(0, 20));
    const pluginTable = this.generatePluginTable(report.plugins.slice(0, 20));

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Build Performance Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; background: #f5f5f5; }
    .container { max-width: 1200px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    h1 { color: #333; margin-bottom: 10px; }
    .timestamp { color: #666; font-size: 14px; margin-bottom: 30px; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
    .summary-card { background: #f8f9fa; padding: 20px; border-radius: 6px; border-left: 4px solid #007bff; }
    .summary-card h3 { font-size: 14px; color: #666; margin-bottom: 5px; }
    .summary-card .value { font-size: 24px; font-weight: bold; color: #333; }
    .section { margin-bottom: 40px; }
    .section h2 { color: #333; margin-bottom: 15px; font-size: 20px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e0e0e0; }
    th { background: #f8f9fa; font-weight: 600; color: #333; }
    tr:hover { background: #f8f9fa; }
    .bar { height: 20px; background: linear-gradient(90deg, #007bff, #0056b3); border-radius: 4px; }
    .bar-container { background: #e9ecef; border-radius: 4px; overflow: hidden; }
    .slow { color: #dc3545; }
    .moderate { color: #ffc107; }
    .fast { color: #28a745; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Build Performance Report</h1>
    <div class="timestamp">Generated: ${new Date(report.timestamp).toLocaleString()}</div>

    <div class="summary">
      <div class="summary-card">
        <h3>Total Build Time</h3>
        <div class="value">${report.totalTime.toFixed(2)}ms</div>
      </div>
      <div class="summary-card">
        <h3>Total Modules</h3>
        <div class="value">${report.summary.totalModules}</div>
      </div>
      <div class="summary-card">
        <h3>Avg Module Time</h3>
        <div class="value">${report.summary.averageModuleTime.toFixed(2)}ms</div>
      </div>
      <div class="summary-card">
        <h3>Total Plugin Time</h3>
        <div class="value">${report.summary.totalPluginTime.toFixed(2)}ms</div>
      </div>
    </div>

    <div class="section">
      <h2>Build Phases</h2>
      ${phaseChart}
    </div>

    <div class="section">
      <h2>Top 20 Slowest Modules</h2>
      ${moduleTable}
    </div>

    <div class="section">
      <h2>Top 20 Plugin Executions</h2>
      ${pluginTable}
    </div>

    ${
      report.memory
        ? `
    <div class="section">
      <h2>Memory Usage</h2>
      <table>
        <tr><th>Metric</th><th>Value</th></tr>
        <tr><td>Initial</td><td>${this.formatBytes(report.memory.initial)}</td></tr>
        <tr><td>Peak</td><td>${this.formatBytes(report.memory.peak)}</td></tr>
        <tr><td>Final</td><td>${this.formatBytes(report.memory.final)}</td></tr>
        <tr><td>Delta</td><td>${this.formatBytes(report.memory.delta)}</td></tr>
      </table>
    </div>
    `
        : ''
    }
  </div>
</body>
</html>`;
  }

  /**
   * Generate phase chart HTML
   */
  private generatePhaseChart(phases: PhaseMetric[]): string {
    return phases
      .map(
        (phase) => `
      <div style="margin-bottom: 15px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
          <strong>${phase.name}</strong>
          <span>${phase.duration.toFixed(2)}ms (${phase.percentage.toFixed(1)}%)</span>
        </div>
        <div class="bar-container">
          <div class="bar" style="width: ${phase.percentage}%"></div>
        </div>
      </div>
    `
      )
      .join('');
  }

  /**
   * Generate module table HTML
   */
  private generateModuleTable(modules: ModuleMetric[]): string {
    const rows = modules
      .map(
        (module) => `
      <tr>
        <td>${module.id}</td>
        <td>${module.compilationTime.toFixed(2)}ms</td>
        <td>${module.transformTime.toFixed(2)}ms</td>
        <td>${this.formatBytes(module.size)}</td>
        <td>${module.dependencies}</td>
      </tr>
    `
      )
      .join('');

    return `
      <table>
        <thead>
          <tr>
            <th>Module</th>
            <th>Compilation</th>
            <th>Transform</th>
            <th>Size</th>
            <th>Dependencies</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  /**
   * Generate plugin table HTML
   */
  private generatePluginTable(plugins: PluginMetric[]): string {
    const rows = plugins
      .map(
        (plugin) => `
      <tr>
        <td>${plugin.name}</td>
        <td>${plugin.hook}</td>
        <td>${plugin.totalTime.toFixed(2)}ms</td>
        <td>${plugin.callCount}</td>
        <td>${(plugin.totalTime / plugin.callCount).toFixed(2)}ms</td>
      </tr>
    `
      )
      .join('');

    return `
      <table>
        <thead>
          <tr>
            <th>Plugin</th>
            <th>Hook</th>
            <th>Total Time</th>
            <th>Calls</th>
            <th>Avg Time</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  /**
   * Generate flamegraph data
   */
  private async generateFlamegraphData(report: PerformanceReport): Promise<void> {
    // Generate flamegraph-compatible data
    const flamegraphData = this.convertToFlamegraph(report);
    const filepath = path.join(this.config.outputDir, `flamegraph-${Date.now()}.txt`);

    await fs.writeFile(filepath, flamegraphData, 'utf-8');
  }

  /**
   * Convert report to flamegraph format
   */
  private convertToFlamegraph(report: PerformanceReport): string {
    const lines: string[] = [];

    for (const [name, entry] of this.metrics) {
      if (entry.duration) {
        const stack = entry.parent ? `${entry.parent};${name}` : name;
        lines.push(`${stack} ${Math.round(entry.duration)}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Get current memory usage
   */
  private getMemoryUsage(): number {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      return process.memoryUsage().heapUsed;
    }
    return 0;
  }

  /**
   * Format bytes to human-readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB'];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${units[i]}`;
  }

  /**
   * Open report in browser (platform-specific)
   */
  private async openInBrowser(filepath: string): Promise<void> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    const platform = process.platform;
    let command: string;

    if (platform === 'darwin') {
      command = `open "${filepath}"`;
    } else if (platform === 'win32') {
      command = `start "${filepath}"`;
    } else {
      command = `xdg-open "${filepath}"`;
    }

    try {
      await execAsync(command);
    } catch (error) {
      console.warn('Failed to open report in browser:', error);
    }
  }
}

/**
 * Create a build profiler instance
 */
export function createBuildProfiler(config: BuildProfilerConfig = {}): BuildProfiler {
  return new BuildProfiler(config);
}

/**
 * Profiler decorator for timing functions
 */
export function Profile(profiler: BuildProfiler, metricName?: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const name = metricName || `${target.constructor.name}.${propertyKey}`;

    descriptor.value = async function (...args: any[]) {
      profiler.startMetric(name);
      try {
        const result = await originalMethod.apply(this, args);
        return result;
      } finally {
        profiler.endMetric(name);
      }
    };

    return descriptor;
  };
}
