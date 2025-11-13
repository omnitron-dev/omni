/**
 * Real-world data pipeline workflow example
 * Demonstrates a complete ETL (Extract, Transform, Load) workflow
 */
import { Workflow, Stage, Compensate } from '../../../../src/modules/pm/decorators.js';

interface DataSource {
  type: 'database' | 'api' | 'file';
  url: string;
  credentials?: string;
}

interface DataRecord {
  id: string;
  value: number;
  timestamp: Date;
  metadata?: Record<string, any>;
}

@Workflow()
export default class DataPipelineWorkflow {
  public metrics = {
    extracted: 0,
    validated: 0,
    transformed: 0,
    loaded: 0,
    failed: 0,
  };

  private extractedData: DataRecord[] = [];
  private validatedData: DataRecord[] = [];
  private transformedData: any[] = [];
  private loadComplete = false;

  @Stage({ name: 'extract', timeout: 30000 })
  async extract(source: DataSource): Promise<{ records: DataRecord[]; count: number }> {
    // Simulate data extraction from external source
    await new Promise((resolve) => setTimeout(resolve, 100));

    this.extractedData = Array.from({ length: 1000 }, (_, i) => ({
      id: `REC-${i}`,
      value: Math.random() * 1000,
      timestamp: new Date(),
      metadata: { source: source.type },
    }));

    this.metrics.extracted = this.extractedData.length;

    return {
      records: this.extractedData,
      count: this.extractedData.length,
    };
  }

  @Stage({ name: 'validate', dependsOn: 'extract' })
  async validate(data: any): Promise<{ valid: number; invalid: number }> {
    // Simulate data validation
    await new Promise((resolve) => setTimeout(resolve, 50));

    this.validatedData = this.extractedData.filter((record) => {
      // Validation rules
      if (!record.id || record.value < 0 || !record.timestamp) {
        this.metrics.failed++;
        return false;
      }
      return true;
    });

    this.metrics.validated = this.validatedData.length;

    return {
      valid: this.validatedData.length,
      invalid: this.extractedData.length - this.validatedData.length,
    };
  }

  @Stage({ name: 'transform-normalize', dependsOn: 'validate', parallel: true })
  async transformNormalize(data: any): Promise<{ count: number }> {
    // Normalize data values
    await new Promise((resolve) => setTimeout(resolve, 80));

    const normalized = this.validatedData.map((record) => ({
      ...record,
      normalizedValue: record.value / 1000,
      processed: true,
    }));

    return { count: normalized.length };
  }

  @Stage({ name: 'transform-enrich', dependsOn: 'validate', parallel: true })
  async transformEnrich(data: any): Promise<{ count: number }> {
    // Enrich data with additional information
    await new Promise((resolve) => setTimeout(resolve, 80));

    const enriched = this.validatedData.map((record) => ({
      ...record,
      category: record.value > 500 ? 'high' : 'low',
      priority: record.value > 750 ? 'urgent' : 'normal',
    }));

    return { count: enriched.length };
  }

  @Stage({
    name: 'transform-aggregate',
    dependsOn: ['transform-normalize', 'transform-enrich'],
  })
  async transformAggregate(data: any): Promise<{ aggregated: any }> {
    // Aggregate transformed data
    await new Promise((resolve) => setTimeout(resolve, 40));

    this.transformedData = this.validatedData.map((record) => ({
      id: record.id,
      value: record.value,
      normalizedValue: record.value / 1000,
      category: record.value > 500 ? 'high' : 'low',
      priority: record.value > 750 ? 'urgent' : 'normal',
      timestamp: record.timestamp,
      metadata: record.metadata,
    }));

    this.metrics.transformed = this.transformedData.length;

    const summary = {
      total: this.transformedData.length,
      high: this.transformedData.filter((r) => r.category === 'high').length,
      low: this.transformedData.filter((r) => r.category === 'low').length,
      urgent: this.transformedData.filter((r) => r.priority === 'urgent').length,
      avgValue: this.transformedData.reduce((sum, r) => sum + r.value, 0) / this.transformedData.length,
    };

    return { aggregated: summary };
  }

  @Stage({ name: 'load', dependsOn: 'transform-aggregate', timeout: 20000, retries: 3 })
  async load(data: any): Promise<{ loaded: boolean; count: number; destination: string }> {
    // Simulate loading data to destination
    await new Promise((resolve) => setTimeout(resolve, 100));

    // In real scenario, this would write to database, API, etc.
    this.loadComplete = true;
    this.metrics.loaded = this.transformedData.length;

    return {
      loaded: true,
      count: this.transformedData.length,
      destination: 'warehouse',
    };
  }

  @Compensate('load')
  async rollbackLoad(): Promise<void> {
    // Rollback loaded data if something fails downstream
    if (this.loadComplete) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      this.loadComplete = false;
      this.metrics.loaded = 0;
    }
  }

  @Stage({ name: 'notify', dependsOn: 'load' })
  async notify(data: any): Promise<{ notified: boolean }> {
    // Send notification about pipeline completion
    await new Promise((resolve) => setTimeout(resolve, 30));

    return {
      notified: true,
    };
  }

  // Helper method to get final metrics
  getMetrics() {
    return { ...this.metrics };
  }
}
