# Meridian Metrics System Specification
**Production-Grade Observability & Data-Driven Optimization**

Version: 1.0.0
Status: Design Phase
Last Updated: 2025-10-18

## Table of Contents

- [Executive Summary](#executive-summary)
- [Research & Best Practices](#research--best-practices)
- [Architecture Overview](#architecture-overview)
- [Metric Categories](#metric-categories)
- [Data Structures](#data-structures)
- [Storage Schema](#storage-schema)
- [Collection Strategy](#collection-strategy)
- [MCP Tools Specification](#mcp-tools-specification)
- [Implementation Plan](#implementation-plan)
- [Expected Impact](#expected-impact)
- [Testing Strategy](#testing-strategy)

## Executive Summary

### Vision

Build a comprehensive metrics collection subsystem for Meridian that enables:
- **Data-driven optimization** - Identify bottlenecks through quantitative analysis
- **Performance regression detection** - Track metrics over time to catch degradation
- **User behavior insights** - Understand which tools provide the most value
- **Resource planning** - Make informed decisions about cache sizes, indexing strategies
- **Operational excellence** - Monitor system health in production deployments

### Key Design Principles

1. **Zero Performance Impact** - Async collection, lock-free counters, minimal overhead
2. **Prometheus-Compatible** - Export standard Prometheus format for existing tooling
3. **OpenTelemetry-Aligned** - Follow semantic conventions for consistency
4. **Google SRE Golden Signals** - Focus on latency, traffic, errors, saturation
5. **Token-Efficiency First** - Track savings to prove Meridian's value proposition
6. **Progressive Disclosure** - Summary → Detailed → Raw data hierarchy

### Scope

**In Scope:**
- MCP tool execution metrics (latency, tokens, errors)
- Memory system metrics (cache hit rates, episode quality)
- Search & indexing metrics (query performance, index size)
- Session metrics (duration, completion rates)
- Token efficiency metrics (savings vs baseline)
- System resource metrics (memory, CPU, disk)

**Out of Scope (v1):**
- Distributed tracing (defer to v2)
- Custom alerting rules (use Prometheus Alertmanager)
- Real-time dashboards (use Grafana)
- Metrics export to cloud services

---

## Research & Best Practices

### Prometheus Best Practices

**Histogram vs Summary for Latency:**
- **Use Histograms** for latency metrics (industry consensus 2025)
- Allows aggregation across instances
- Flexible percentile calculation at query time
- Better performance (count per bucket)

**Recommended Buckets for Latency:**
```rust
// Based on Prometheus best practices
const LATENCY_BUCKETS: &[f64] = &[
    0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5,
    1.0, 2.5, 5.0, 10.0, 25.0, 50.0, 100.0
]; // seconds
```

**Token Count Buckets:**
```rust
const TOKEN_BUCKETS: &[f64] = &[
    10.0, 50.0, 100.0, 250.0, 500.0, 1000.0,
    2500.0, 5000.0, 10000.0, 25000.0, 50000.0
];
```

### OpenTelemetry Semantic Conventions

**Naming Patterns:**
- `{domain}.{operation}.{unit}` - e.g., `mcp.tool.duration`
- Use lowercase with underscores
- Suffix with unit: `_seconds`, `_bytes`, `_total`

**Standard Attributes:**
- `service.name` - "meridian"
- `service.version` - Meridian version
- `tool.name` - MCP tool name
- `error.type` - Error category
- `session.id` - Session identifier

### Google SRE Golden Signals

**Applied to Meridian:**

1. **Latency** - Tool execution time, search query time
2. **Traffic** - Tools called per hour, searches per minute
3. **Errors** - Tool failures, indexing errors, search failures
4. **Saturation** - Cache utilization, index size, memory pressure

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      MCP Tool Layer                          │
│  (Intercept all tool calls for metrics collection)          │
└─────────────────────────────┬───────────────────────────────┘
                              │
                    ┌─────────▼──────────┐
                    │  MetricsCollector  │
                    │  (Lock-free)       │
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │  MetricsAggregator │
                    │  (1-minute batches)│
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │   RocksDB Storage  │
                    │   (Time-series)    │
                    └─────────┬──────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
      ┌───────▼────┐  ┌──────▼─────┐  ┌─────▼──────┐
      │ MCP Query  │  │ Prometheus │  │  Retention │
      │   Tools    │  │   Export   │  │   Policy   │
      └────────────┘  └────────────┘  └────────────┘
```

### Component Responsibilities

**MetricsCollector:**
- Lock-free atomic counters for high-frequency updates
- Per-tool histogram tracking (latency, tokens)
- Error categorization and counting
- Non-blocking async flush to aggregator

**MetricsAggregator:**
- Batch aggregation every 60 seconds
- Calculate percentiles from histograms
- Compute derived metrics (averages, rates)
- Write aggregates to RocksDB

**RocksDB Storage:**
- Time-series optimized key structure
- Automatic retention policy enforcement
- Efficient range queries for time windows
- Prefix-based aggregation queries

**MCP Tools:**
- Query metrics with time ranges
- Export Prometheus format
- Get efficiency reports
- Analyze trends

---

## Metric Categories

### 1. MCP Tool Metrics

Track performance and usage of every MCP tool.

**Golden Signals Applied:**
- **Latency**: p50, p95, p99 execution time
- **Traffic**: Calls per hour/day
- **Errors**: Failure rate by error type
- **Saturation**: Concurrent executions (future)

**Per-Tool Tracking:**
```rust
pub struct ToolMetrics {
    // Identity
    pub tool_name: String,
    pub timestamp: DateTime<Utc>,

    // Traffic (Golden Signal #2)
    pub total_calls: u64,
    pub calls_last_hour: u64,
    pub calls_last_24h: u64,

    // Latency (Golden Signal #1)
    pub latency_histogram: Histogram,  // Prometheus-style
    pub p50_latency_ms: f64,
    pub p95_latency_ms: f64,
    pub p99_latency_ms: f64,
    pub avg_latency_ms: f64,
    pub max_latency_ms: f64,

    // Errors (Golden Signal #3)
    pub success_count: u64,
    pub error_count: u64,
    pub error_rate: f64,  // errors / total_calls
    pub error_breakdown: HashMap<ErrorType, u64>,

    // Token Efficiency
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub avg_input_tokens: f64,
    pub avg_output_tokens: f64,
    pub token_histogram: Histogram,

    // Saturation indicators (future)
    pub concurrent_executions: u64,
    pub queue_depth: u64,
}

#[derive(Hash, Eq, PartialEq, Serialize, Deserialize)]
pub enum ErrorType {
    InvalidArguments,
    ResourceNotFound,
    PermissionDenied,
    StorageError,
    IndexingError,
    TimeoutError,
    InternalError,
    Unknown,
}
```

**Histogram Implementation:**
```rust
pub struct Histogram {
    pub buckets: Vec<Bucket>,
    pub count: u64,
    pub sum: f64,
}

pub struct Bucket {
    pub upper_bound: f64,
    pub count: u64,
}

// Prometheus-compatible histogram
impl Histogram {
    pub fn new(buckets: &[f64]) -> Self {
        let buckets = buckets.iter()
            .map(|&ub| Bucket { upper_bound: ub, count: 0 })
            .collect();

        Self { buckets, count: 0, sum: 0.0 }
    }

    pub fn observe(&mut self, value: f64) {
        self.count += 1;
        self.sum += value;

        for bucket in &mut self.buckets {
            if value <= bucket.upper_bound {
                bucket.count += 1;
            }
        }
    }

    pub fn quantile(&self, q: f64) -> f64 {
        // Prometheus histogram_quantile calculation
        // Linear interpolation between buckets
        prometheus_quantile(q, &self.buckets)
    }
}
```

### 2. Memory System Metrics

Track the effectiveness of the cognitive memory system.

**Categories:**
- Episodic Memory (learning from past tasks)
- Working Memory (cache performance)
- Semantic Memory (pattern consolidation)
- Procedural Memory (task automation)

```rust
pub struct MemoryMetrics {
    pub timestamp: DateTime<Utc>,

    // Episodic Memory
    pub episodic: EpisodicMetrics {
        pub total_episodes: u64,
        pub episodes_last_24h: u64,
        pub avg_episode_size_bytes: f64,

        // Quality indicators
        pub avg_retrieval_frequency: f64,  // How often episodes are accessed
        pub episodes_never_accessed: u64,
        pub avg_usefulness_score: f64,  // Based on feedback

        // Learning effectiveness
        pub patterns_extracted: u64,
        pub pattern_extraction_rate: f64,  // patterns per episode
        pub similar_episode_hit_rate: f64,  // Found useful similar episodes
    },

    // Working Memory (Cache)
    pub working: WorkingMemoryMetrics {
        pub cache_size_bytes: u64,
        pub cache_capacity_bytes: u64,
        pub cache_utilization: f64,  // size / capacity

        // Performance (Saturation indicator)
        pub cache_hit_rate: f64,
        pub cache_miss_rate: f64,
        pub evictions_per_hour: u64,

        // Attention mechanism
        pub avg_attention_decay_rate: f64,
        pub prefetch_accuracy: f64,  // correct predictions / total
        pub prefetch_waste_rate: f64,  // unused prefetches
    },

    // Semantic Memory (Knowledge Graph)
    pub semantic: SemanticMetrics {
        pub total_patterns: u64,
        pub patterns_last_24h: u64,
        pub avg_pattern_confidence: f64,

        // Consolidation
        pub pattern_consolidation_rate: f64,  // patterns merged per day
        pub pattern_accuracy: f64,  // successful pattern applications

        // Graph structure
        pub knowledge_graph_nodes: u64,
        pub knowledge_graph_edges: u64,
        pub avg_node_degree: f64,
        pub graph_clustering_coefficient: f64,
    },

    // Procedural Memory (Automation)
    pub procedural: ProceduralMetrics {
        pub total_procedures: u64,
        pub procedures_executed: u64,
        pub procedure_success_rate: f64,

        // Coverage
        pub task_types_covered: u64,
        pub task_type_coverage: HashMap<String, f64>,

        // Effectiveness
        pub avg_time_saved_seconds: f64,
        pub automation_rate: f64,  // automated / total tasks
    },
}
```

### 3. Search & Indexing Metrics

Track search performance and index quality.

```rust
pub struct SearchMetrics {
    pub timestamp: DateTime<Utc>,

    // Search Performance (Golden Signals)
    pub total_queries: u64,
    pub queries_last_hour: u64,

    // Latency
    pub avg_query_latency_ms: f64,
    pub p50_query_latency_ms: f64,
    pub p95_query_latency_ms: f64,
    pub p99_query_latency_ms: f64,

    // Quality
    pub avg_results_returned: f64,
    pub zero_results_rate: f64,
    pub avg_result_relevance: f64,  // Based on user selection

    // Query types
    pub search_type_breakdown: HashMap<SearchType, QueryStats>,

    // Indexing Performance
    pub indexing: IndexingMetrics {
        pub total_files_indexed: u64,
        pub files_indexed_last_hour: u64,
        pub avg_indexing_time_ms: f64,

        // Index composition
        pub files_by_language: HashMap<String, u64>,
        pub total_symbols: u64,
        pub symbols_by_type: HashMap<SymbolType, u64>,

        // Storage
        pub index_size_bytes: u64,
        pub vector_index_size_bytes: u64,
        pub avg_file_size_bytes: f64,

        // Real-time updates
        pub incremental_updates_per_hour: u64,
        pub avg_incremental_update_ms: f64,
        pub file_watch_lag_ms: f64,  // Time from file change to index update
    },

    // Vector Search (HNSW)
    pub vector: VectorSearchMetrics {
        pub total_vector_searches: u64,
        pub avg_vector_search_ms: f64,
        pub avg_hnsw_comparisons: u64,
        pub avg_candidates_evaluated: u64,
    },
}

#[derive(Hash, Eq, PartialEq)]
pub enum SearchType {
    Semantic,      // Vector-based
    Hybrid,        // Vector + keyword
    Keyword,       // Traditional text search
    SymbolName,    // Exact symbol lookup
    TypeFilter,    // By symbol type
    DependencyWalk, // Graph traversal
}

pub struct QueryStats {
    pub count: u64,
    pub avg_latency_ms: f64,
    pub avg_results: f64,
}
```

### 4. Session Metrics

Track development session patterns and effectiveness.

```rust
pub struct SessionMetrics {
    pub timestamp: DateTime<Utc>,

    // Volume
    pub total_sessions: u64,
    pub active_sessions: u64,
    pub sessions_last_24h: u64,

    // Duration
    pub avg_session_duration_minutes: f64,
    pub median_session_duration_minutes: f64,
    pub total_session_time_hours: f64,

    // Activity
    pub avg_actions_per_session: f64,
    pub avg_files_modified_per_session: f64,
    pub avg_tools_used_per_session: f64,

    // Outcomes
    pub session_completion_rate: f64,  // committed / total
    pub rollback_rate: f64,            // rolled back / total
    pub discard_rate: f64,             // discarded / total

    // Session types
    pub session_breakdown: HashMap<SessionType, SessionTypeStats>,

    // Efficiency
    pub avg_commit_size_lines: f64,
    pub avg_time_to_first_action_seconds: f64,
    pub avg_idle_time_percentage: f64,
}

#[derive(Hash, Eq, PartialEq)]
pub enum SessionType {
    Implementation,  // New code
    Debugging,       // Bug fixes
    Refactoring,     // Code cleanup
    Documentation,   // Docs/comments
    Exploration,     // Code reading
}

pub struct SessionTypeStats {
    pub count: u64,
    pub avg_duration_minutes: f64,
    pub completion_rate: f64,
}
```

### 5. Token Efficiency Metrics

Quantify Meridian's value proposition: saving LLM tokens.

```rust
pub struct TokenEfficiencyMetrics {
    pub timestamp: DateTime<Utc>,

    // Total Savings
    pub total_tokens_saved: u64,
    pub tokens_saved_last_24h: u64,
    pub savings_percentage: f64,  // vs naive approach

    // Baseline Comparison
    pub baseline_tokens_used: u64,      // What it would be without Meridian
    pub actual_tokens_used: u64,        // With Meridian optimizations
    pub theoretical_max_savings: u64,   // Best possible case
    pub efficiency_score: f64,          // actual / theoretical (0-1)

    // Savings by Technique
    pub savings_by_technique: HashMap<Technique, TechniqueSavings>,

    // Cost Savings (if pricing info available)
    pub estimated_cost_saved_usd: f64,
    pub avg_cost_per_operation_usd: f64,

    // Context Management
    pub avg_context_window_utilization: f64,
    pub context_overflow_prevented_count: u64,
    pub avg_compression_ratio: f64,
}

#[derive(Hash, Eq, PartialEq)]
pub enum Technique {
    ProgressiveLoading,     // Load summaries first
    SymbolExtraction,       // Get single symbol vs whole file
    ContextCaching,         // Reuse previous context
    SmartFiltering,         // Filter by relevance
    SemanticSearch,         // Find exactly what's needed
    ContextCompression,     // Skeleton/summary modes
    DetailLevelControl,     // Interface vs implementation
    PrefetchAccuracy,       // Predict what's needed
    TreeShaking,            // Remove unused code
}

pub struct TechniqueSavings {
    pub tokens_saved: u64,
    pub usage_count: u64,
    pub avg_savings_per_use: f64,
    pub effectiveness_score: f64,
}
```

### 6. System Resource Metrics

Track Meridian's own resource consumption (Saturation).

```rust
pub struct SystemMetrics {
    pub timestamp: DateTime<Utc>,

    // Memory
    pub memory: MemoryUsage {
        pub total_used_bytes: u64,
        pub heap_bytes: u64,
        pub rocksdb_cache_bytes: u64,
        pub vector_index_bytes: u64,
        pub session_cache_bytes: u64,

        // Pressure indicators
        pub memory_pressure: f64,  // 0.0 - 1.0
        pub swap_used_bytes: u64,
        pub page_faults_per_second: f64,
    },

    // CPU
    pub cpu: CpuUsage {
        pub cpu_usage_percentage: f64,
        pub indexing_cpu_percentage: f64,
        pub search_cpu_percentage: f64,
        pub background_tasks_cpu_percentage: f64,

        pub avg_cpu_per_tool_call: f64,
        pub cpu_throttling_events: u64,
    },

    // Disk I/O
    pub disk: DiskUsage {
        pub total_db_size_bytes: u64,
        pub rocksdb_size_bytes: u64,
        pub index_size_bytes: u64,

        pub read_ops_per_second: f64,
        pub write_ops_per_second: f64,
        pub avg_read_latency_ms: f64,
        pub avg_write_latency_ms: f64,

        pub disk_space_available_bytes: u64,
        pub disk_usage_percentage: f64,
    },

    // Network (for global daemon)
    pub network: Option<NetworkUsage> {
        pub ipc_calls_per_second: f64,
        pub avg_ipc_latency_ms: f64,
        pub bytes_sent_per_second: u64,
        pub bytes_received_per_second: u64,
    },
}
```

---

## Storage Schema

### RocksDB Key Structure

Time-series optimized with automatic retention.

```
# Tool Metrics (Raw - 7 day retention)
metrics:tool:{tool_name}:raw:{timestamp_ms} → ToolMetricsSample
  Example: metrics:tool:code.search_symbols:raw:1729262400000

# Tool Metrics (Hourly aggregates - 90 day retention)
metrics:tool:{tool_name}:hourly:{hour_timestamp} → ToolMetricsAggregate
  Example: metrics:tool:code.search_symbols:hourly:1729260000

# Tool Metrics (Daily aggregates - 1 year retention)
metrics:tool:{tool_name}:daily:{date} → ToolMetricsAggregate
  Example: metrics:tool:code.search_symbols:daily:2025-10-18

# Memory System (Snapshots - 90 day retention)
metrics:memory:snapshot:{timestamp_ms} → MemoryMetrics
  Example: metrics:memory:snapshot:1729262400000

# Memory System (Daily aggregates - 1 year retention)
metrics:memory:daily:{date} → MemoryMetricsAggregate

# Search Metrics (Hourly - 90 day retention)
metrics:search:hourly:{hour_timestamp} → SearchMetrics

# Session Metrics (Per session - 90 day retention)
metrics:session:{session_id} → SessionMetrics
  Example: metrics:session:550e8400-e29b-41d4-a716-446655440000

# Session Metrics (Daily aggregates - 1 year retention)
metrics:session:daily:{date} → SessionMetricsAggregate

# Token Efficiency (Daily - 1 year retention)
metrics:tokens:daily:{date} → TokenEfficiencyMetrics

# System Resources (5-minute samples - 30 day retention)
metrics:system:sample:{timestamp_ms} → SystemMetrics

# System Resources (Hourly - 90 day retention)
metrics:system:hourly:{hour_timestamp} → SystemMetricsAggregate

# Metadata
metrics:meta:retention_policy → RetentionConfig
metrics:meta:collection_config → CollectionConfig
metrics:meta:last_aggregation → Timestamp
```

### Index Keys

For efficient queries:

```
# All tools (for listing)
metrics:index:tools → Set<String>

# Active sessions
metrics:index:sessions:active → Set<SessionId>

# Time range indexes
metrics:index:range:hourly:{start_hour}:{end_hour} → Set<MetricKey>
metrics:index:range:daily:{start_date}:{end_date} → Set<MetricKey>
```

### Retention Policy

```rust
pub struct RetentionConfig {
    pub raw_samples: Duration,        // 7 days
    pub hourly_aggregates: Duration,  // 90 days
    pub daily_aggregates: Duration,   // 365 days
    pub session_data: Duration,       // 90 days
    pub system_samples: Duration,     // 30 days
}

impl Default for RetentionConfig {
    fn default() -> Self {
        Self {
            raw_samples: Duration::days(7),
            hourly_aggregates: Duration::days(90),
            daily_aggregates: Duration::days(365),
            session_data: Duration::days(90),
            system_samples: Duration::days(30),
        }
    }
}
```

---

## Collection Strategy

### Real-Time Collection

**Zero-Copy, Lock-Free Design:**

```rust
use std::sync::atomic::{AtomicU64, Ordering};
use parking_lot::RwLock;

/// Lock-free metrics collector
pub struct MetricsCollector {
    // Per-tool atomic counters (fast path)
    tool_counters: DashMap<String, ToolCounters>,

    // Histograms (occasional write lock)
    tool_histograms: DashMap<String, Arc<RwLock<ToolHistograms>>>,

    // Aggregator channel (async, non-blocking)
    aggregator_tx: mpsc::UnboundedSender<MetricEvent>,
}

struct ToolCounters {
    total_calls: AtomicU64,
    success_count: AtomicU64,
    error_count: AtomicU64,
    total_input_tokens: AtomicU64,
    total_output_tokens: AtomicU64,
}

struct ToolHistograms {
    latency: Histogram,
    input_tokens: Histogram,
    output_tokens: Histogram,
}

impl MetricsCollector {
    /// Record tool execution (called from MCP handler interceptor)
    pub fn record_tool_execution(
        &self,
        tool_name: &str,
        duration: Duration,
        result: &Result<ToolResult>,
        input_tokens: u64,
        output_tokens: u64,
    ) {
        // Fast atomic increments (no locks)
        let counters = self.tool_counters
            .entry(tool_name.to_string())
            .or_insert_with(ToolCounters::default);

        counters.total_calls.fetch_add(1, Ordering::Relaxed);
        counters.total_input_tokens.fetch_add(input_tokens, Ordering::Relaxed);
        counters.total_output_tokens.fetch_add(output_tokens, Ordering::Relaxed);

        match result {
            Ok(_) => counters.success_count.fetch_add(1, Ordering::Relaxed),
            Err(_) => counters.error_count.fetch_add(1, Ordering::Relaxed),
        };

        // Histogram update (occasional write lock, acceptable)
        if let Some(histograms) = self.tool_histograms.get(tool_name) {
            let mut h = histograms.write();
            h.latency.observe(duration.as_secs_f64());
            h.input_tokens.observe(input_tokens as f64);
            h.output_tokens.observe(output_tokens as f64);
        }

        // Async event for detailed logging (non-blocking)
        let _ = self.aggregator_tx.send(MetricEvent::ToolExecution {
            tool_name: tool_name.to_string(),
            timestamp: Utc::now(),
            duration,
            result: result.is_ok(),
            error_type: result.as_ref().err().map(classify_error),
            input_tokens,
            output_tokens,
        });
    }
}
```

### MCP Handler Interceptor

Wrap all tool executions transparently:

```rust
// In mcp/handlers.rs

impl ToolHandlers {
    pub async fn handle_tool_call(&self, name: &str, arguments: Value) -> Result<Value> {
        let start = Instant::now();
        let input_tokens = estimate_input_tokens(&arguments);

        // Execute tool
        let result = self.dispatch_tool(name, arguments).await;

        // Record metrics (async, non-blocking)
        let duration = start.elapsed();
        let output_tokens = result.as_ref()
            .map(estimate_output_tokens)
            .unwrap_or(0);

        self.metrics_collector.record_tool_execution(
            name,
            duration,
            &result,
            input_tokens,
            output_tokens,
        );

        result
    }
}
```

### Batching & Aggregation

```rust
/// Aggregator runs in background task
pub struct MetricsAggregator {
    collector: Arc<MetricsCollector>,
    storage: Arc<dyn Storage>,
    config: AggregationConfig,
}

pub struct AggregationConfig {
    pub flush_interval: Duration,  // Default: 60 seconds
    pub batch_size: usize,         // Default: 1000 events
}

impl MetricsAggregator {
    pub async fn run(&self) {
        let mut interval = tokio::time::interval(self.config.flush_interval);

        loop {
            interval.tick().await;

            if let Err(e) = self.aggregate_and_flush().await {
                tracing::error!("Metrics aggregation failed: {}", e);
            }
        }
    }

    async fn aggregate_and_flush(&self) -> Result<()> {
        let now = Utc::now();

        // 1. Collect snapshot from atomic counters
        let tool_snapshots = self.collector.snapshot_tool_metrics();

        // 2. Calculate percentiles from histograms
        let tool_aggregates = self.calculate_percentiles(tool_snapshots);

        // 3. Write to RocksDB (batched)
        let mut batch = Vec::new();

        for (tool_name, metrics) in tool_aggregates {
            // Raw sample
            let key = format!("metrics:tool:{}:raw:{}", tool_name, now.timestamp_millis());
            batch.push(WriteOp::Put {
                key: key.into_bytes(),
                value: bincode::serialize(&metrics)?,
            });

            // Update hourly aggregate
            self.update_hourly_aggregate(&tool_name, &metrics, now)?;
        }

        self.storage.batch_write(batch).await?;

        // 4. Enforce retention policy
        self.enforce_retention(now).await?;

        Ok(())
    }
}
```

### Retention Enforcement

```rust
impl MetricsAggregator {
    async fn enforce_retention(&self, now: DateTime<Utc>) -> Result<()> {
        let config = self.load_retention_config().await?;

        // Delete expired raw samples
        let cutoff_raw = now - config.raw_samples;
        self.delete_range(
            b"metrics:tool:",
            b":raw:",
            cutoff_raw.timestamp_millis()
        ).await?;

        // Delete expired hourly aggregates
        let cutoff_hourly = now - config.hourly_aggregates;
        self.delete_range(
            b"metrics:",
            b":hourly:",
            cutoff_hourly.timestamp()
        ).await?;

        // ... similar for other metric types

        Ok(())
    }
}
```

---

## MCP Tools Specification

### 1. `metrics.get_tool_stats`

Get statistics for specific tool or all tools.

**Input:**
```typescript
{
  tool_name?: string,      // Omit for all tools
  time_range?: {
    start: string,         // ISO 8601 timestamp
    end: string,           // ISO 8601 timestamp
    granularity: "raw" | "hourly" | "daily"
  },
  include_histogram?: boolean  // Include full histogram data
}
```

**Output:**
```typescript
{
  tools: [
    {
      tool_name: "code.search_symbols",
      time_range: { start: "...", end: "..." },

      // Golden Signal: Traffic
      total_calls: 1543,
      calls_per_hour: 64.3,

      // Golden Signal: Latency
      latency: {
        avg_ms: 45.2,
        p50_ms: 32.1,
        p95_ms: 156.3,
        p99_ms: 342.7,
        max_ms: 1234.5,
        histogram?: [...],  // If requested
      },

      // Golden Signal: Errors
      success_count: 1521,
      error_count: 22,
      error_rate: 0.014,
      errors_by_type: {
        "InvalidArguments": 12,
        "ResourceNotFound": 8,
        "TimeoutError": 2
      },

      // Tokens
      tokens: {
        avg_input: 234.5,
        avg_output: 1432.1,
        total_input: 361835,
        total_output: 2209719
      }
    }
  ],
  summary: {
    total_tools: 72,
    total_calls: 8934,
    avg_latency_ms: 123.4,
    overall_error_rate: 0.023
  }
}
```

**Token Efficiency:** ~500-1500 tokens depending on tool count and time range

### 2. `metrics.get_memory_stats`

Get memory system effectiveness metrics.

**Input:**
```typescript
{
  time_range?: { start: string, end: string },
  include_breakdown?: boolean  // Include per-memory-type details
}
```

**Output:**
```typescript
{
  summary: {
    episodic_episodes: 234,
    working_cache_hit_rate: 0.78,
    semantic_patterns: 156,
    procedural_automation_rate: 0.34
  },

  episodic?: {
    total_episodes: 234,
    episodes_last_24h: 12,
    avg_usefulness_score: 0.67,
    pattern_extraction_rate: 1.4,
    similar_episode_hit_rate: 0.82
  },

  working?: {
    cache_size_mb: 128.5,
    cache_utilization: 0.73,
    cache_hit_rate: 0.78,
    cache_miss_rate: 0.22,
    prefetch_accuracy: 0.65
  },

  semantic?: {
    total_patterns: 156,
    avg_confidence: 0.71,
    pattern_accuracy: 0.83,
    knowledge_graph_nodes: 4521,
    knowledge_graph_edges: 12034
  },

  procedural?: {
    total_procedures: 43,
    success_rate: 0.89,
    avg_time_saved_seconds: 23.4,
    automation_rate: 0.34
  }
}
```

**Token Efficiency:** ~300-800 tokens

### 3. `metrics.get_search_stats`

Get search and indexing performance metrics.

**Input:**
```typescript
{
  time_range?: { start: string, end: string },
  include_query_breakdown?: boolean
}
```

**Output:**
```typescript
{
  search: {
    total_queries: 2341,
    queries_per_hour: 97.5,
    avg_latency_ms: 23.4,
    p95_latency_ms: 67.8,
    zero_results_rate: 0.12,

    by_type?: {
      "Semantic": { count: 1234, avg_latency_ms: 45.2, avg_results: 12.3 },
      "Hybrid": { count: 876, avg_latency_ms: 34.1, avg_results: 8.7 },
      "Keyword": { count: 231, avg_latency_ms: 12.3, avg_results: 15.2 }
    }
  },

  indexing: {
    total_files_indexed: 12543,
    files_by_language: {
      "Rust": 3421,
      "TypeScript": 8234,
      "JavaScript": 888
    },
    total_symbols: 145234,
    index_size_mb: 234.5,
    avg_indexing_time_ms: 123.4,
    incremental_updates_per_hour: 23.4
  },

  vector: {
    avg_search_ms: 12.3,
    avg_comparisons: 234,
    avg_candidates: 45
  }
}
```

**Token Efficiency:** ~400-900 tokens

### 4. `metrics.get_session_stats`

Get session pattern and effectiveness metrics.

**Input:**
```typescript
{
  time_range?: { start: string, end: string },
  session_id?: string,  // Get specific session
  include_breakdown?: boolean
}
```

**Output:**
```typescript
{
  summary: {
    total_sessions: 134,
    avg_duration_minutes: 45.3,
    completion_rate: 0.78,
    avg_actions_per_session: 23.4
  },

  sessions?: [
    {
      session_id: "550e8400-...",
      start_time: "2025-10-18T10:00:00Z",
      end_time: "2025-10-18T11:23:45Z",
      duration_minutes: 83.75,
      actions_count: 34,
      files_modified: 12,
      tools_used: 18,
      outcome: "committed",
      commit_hash: "a1b2c3d4..."
    }
  ],

  by_type?: {
    "Implementation": { count: 67, avg_duration: 52.3, completion_rate: 0.82 },
    "Debugging": { count: 34, avg_duration: 38.1, completion_rate: 0.71 },
    "Refactoring": { count: 23, avg_duration: 41.2, completion_rate: 0.87 }
  }
}
```

**Token Efficiency:** ~500-1200 tokens

### 5. `metrics.get_efficiency_report`

Get token efficiency and cost savings analysis.

**Input:**
```typescript
{
  time_range?: { start: string, end: string },
  include_technique_breakdown?: boolean
}
```

**Output:**
```typescript
{
  summary: {
    total_tokens_saved: 1234567,
    savings_percentage: 68.4,
    estimated_cost_saved_usd: 123.45,
    efficiency_score: 0.84
  },

  baseline_comparison: {
    baseline_tokens: 3845234,
    actual_tokens: 1215678,
    theoretical_max_savings: 2934567,
    efficiency_score: 0.84  // actual savings / theoretical max
  },

  by_technique?: {
    "ProgressiveLoading": {
      tokens_saved: 345678,
      usage_count: 1234,
      avg_savings_per_use: 280.1,
      effectiveness: 0.92
    },
    "SymbolExtraction": {
      tokens_saved: 234567,
      usage_count: 876,
      avg_savings_per_use: 267.8,
      effectiveness: 0.87
    },
    "ContextCompression": {
      tokens_saved: 123456,
      usage_count: 543,
      avg_savings_per_use: 227.3,
      effectiveness: 0.76
    }
  },

  context_management: {
    avg_utilization: 0.67,
    overflow_prevented: 45,
    avg_compression_ratio: 0.23
  }
}
```

**Token Efficiency:** ~400-1000 tokens

### 6. `metrics.get_system_health`

Get system resource utilization (Saturation signals).

**Input:**
```typescript
{
  time_range?: { start: string, end: string }
}
```

**Output:**
```typescript
{
  memory: {
    total_used_mb: 512.3,
    heap_mb: 234.5,
    rocksdb_cache_mb: 128.0,
    vector_index_mb: 89.3,
    memory_pressure: 0.34  // 0-1 scale
  },

  cpu: {
    usage_percentage: 23.4,
    indexing_percentage: 12.3,
    search_percentage: 8.1,
    avg_per_tool_call: 0.34
  },

  disk: {
    total_db_size_mb: 1234.5,
    disk_usage_percentage: 12.3,
    read_ops_per_second: 45.6,
    write_ops_per_second: 23.4,
    avg_read_latency_ms: 2.3
  },

  network?: {
    ipc_calls_per_second: 12.3,
    avg_ipc_latency_ms: 3.4
  }
}
```

**Token Efficiency:** ~200-500 tokens

### 7. `metrics.export_prometheus`

Export all metrics in Prometheus exposition format.

**Input:**
```typescript
{
  format?: "text" | "json",
  include_help?: boolean,
  include_type?: boolean
}
```

**Output (text format):**
```prometheus
# HELP mcp_tool_duration_seconds Tool execution duration
# TYPE mcp_tool_duration_seconds histogram
mcp_tool_duration_seconds_bucket{tool="code.search_symbols",le="0.005"} 234
mcp_tool_duration_seconds_bucket{tool="code.search_symbols",le="0.01"} 567
mcp_tool_duration_seconds_bucket{tool="code.search_symbols",le="0.025"} 1234
mcp_tool_duration_seconds_bucket{tool="code.search_symbols",le="+Inf"} 1543
mcp_tool_duration_seconds_sum{tool="code.search_symbols"} 69.8
mcp_tool_duration_seconds_count{tool="code.search_symbols"} 1543

# HELP mcp_tool_calls_total Total tool invocations
# TYPE mcp_tool_calls_total counter
mcp_tool_calls_total{tool="code.search_symbols"} 1543

# HELP mcp_tool_errors_total Tool execution errors
# TYPE mcp_tool_errors_total counter
mcp_tool_errors_total{tool="code.search_symbols",error_type="InvalidArguments"} 12

# HELP mcp_memory_cache_hit_rate Working memory cache hit rate
# TYPE mcp_memory_cache_hit_rate gauge
mcp_memory_cache_hit_rate 0.78

# ... more metrics
```

**Token Efficiency:** Variable, typically 2000-10000 tokens for full export

### 8. `metrics.analyze_trends`

Analyze metric trends over time (detect regressions).

**Input:**
```typescript
{
  metric_type: "tool" | "memory" | "search" | "session" | "efficiency",
  time_range: { start: string, end: string },
  detect_anomalies?: boolean
}
```

**Output:**
```typescript
{
  trends: [
    {
      metric: "avg_latency_ms",
      tool: "code.search_symbols",
      trend: "increasing",
      change_percentage: 23.4,
      significance: "high",
      alert: "Latency increased 23.4% over last 7 days"
    }
  ],

  anomalies?: [
    {
      timestamp: "2025-10-18T14:23:00Z",
      metric: "error_rate",
      tool: "specs.get_section",
      value: 0.45,
      expected_range: [0.01, 0.05],
      severity: "critical"
    }
  ],

  recommendations: [
    "Consider increasing cache size (hit rate dropped to 0.65)",
    "Investigate code.search_symbols latency spike",
    "Review specs.get_section errors at 2025-10-18 14:23"
  ]
}
```

**Token Efficiency:** ~600-1500 tokens

---

## Implementation Plan

### Phase 1: Core Infrastructure (Week 1 - 8 hours)

**Goal:** Basic metrics collection and storage

**Tasks:**
1. **Data Structures** (2h)
   - Define all metric structs in `src/metrics/types.rs`
   - Implement Histogram with Prometheus compatibility
   - Create serialization/deserialization

2. **Storage Schema** (2h)
   - Design RocksDB key structure in `src/metrics/storage.rs`
   - Implement retention policy enforcement
   - Create index management

3. **MetricsCollector** (4h)
   - Lock-free atomic counters in `src/metrics/collector.rs`
   - DashMap-based per-tool tracking
   - Histogram recording with RwLock

**Deliverables:**
- `src/metrics/types.rs` - All data structures
- `src/metrics/storage.rs` - RocksDB schema implementation
- `src/metrics/collector.rs` - Lock-free collector
- Unit tests for data structures

### Phase 2: Collection Hooks (Week 1 - 6 hours)

**Goal:** Integrate collection into MCP server

**Tasks:**
1. **MCP Handler Interceptor** (3h)
   - Wrap `handle_tool_call` in `src/mcp/handlers.rs`
   - Token estimation functions
   - Error classification

2. **Memory System Hooks** (2h)
   - Hook into cache operations
   - Track episode creation/retrieval
   - Monitor pattern extraction

3. **Search Hooks** (1h)
   - Integrate with search engine
   - Track query performance
   - Monitor index updates

**Deliverables:**
- Modified `src/mcp/handlers.rs` with metrics
- Memory system integration
- Search integration
- Integration tests

### Phase 3: Aggregation Engine (Week 2 - 4 hours)

**Goal:** Background aggregation and retention

**Tasks:**
1. **MetricsAggregator** (2h)
   - Background task in `src/metrics/aggregator.rs`
   - Periodic snapshot collection
   - Percentile calculation

2. **Retention Enforcement** (1h)
   - Automatic deletion of expired data
   - Configurable retention policies
   - Cleanup on startup

3. **Hourly/Daily Rollups** (1h)
   - Aggregate raw samples
   - Compute summary statistics
   - Update indexes

**Deliverables:**
- `src/metrics/aggregator.rs` - Aggregation engine
- Retention policy implementation
- Background task integration
- Tests for aggregation

### Phase 4: MCP Tools + API (Week 2-3 - 6 hours)

**Goal:** Expose metrics via MCP tools

**Tasks:**
1. **Tool Implementations** (3h)
   - Implement 8 MCP tools in `src/mcp/handlers.rs`
   - Time range parsing and validation
   - Progressive detail loading

2. **Prometheus Export** (2h)
   - Text format serialization in `src/metrics/prometheus.rs`
   - Metric name mapping
   - Label generation

3. **Trend Analysis** (1h)
   - Basic trend detection
   - Anomaly detection algorithms
   - Recommendation engine

**Deliverables:**
- 8 MCP tools fully implemented
- Prometheus export functionality
- Trend analysis capabilities
- E2E tests

### Phase 5: Testing + Documentation (Week 3 - 4 hours)

**Goal:** Production readiness

**Tasks:**
1. **Unit Tests** (1.5h)
   - Test all data structures
   - Test collection logic
   - Test aggregation math

2. **Integration Tests** (1.5h)
   - End-to-end MCP tool tests
   - Retention policy tests
   - Performance benchmarks

3. **Documentation** (1h)
   - User guide for metrics tools
   - Prometheus integration guide
   - Grafana dashboard templates

**Deliverables:**
- Comprehensive test suite
- User documentation
- Example Grafana dashboards
- Performance benchmarks

### Total Timeline: 28 hours (3-4 weeks part-time)

---

## Expected Impact

### Quantitative Benefits

**Performance Optimization:**
- Identify slowest tools → optimize → 20-30% latency reduction
- Detect cache misses → tune cache size → 15-25% hit rate improvement
- Find indexing bottlenecks → optimize parsers → 30-40% faster indexing

**Cost Savings:**
- Measure token efficiency → prove ROI → justify Meridian adoption
- Detect token waste → optimize → 10-15% additional savings
- Track baseline comparison → marketing material for Meridian

**Reliability:**
- Detect error rate spikes → fix bugs proactively
- Monitor saturation → prevent crashes from resource exhaustion
- Track session completion → improve user experience

### Qualitative Benefits

**Data-Driven Development:**
- Make architectural decisions based on real usage data
- Prioritize features that users actually use
- Deprecate unused features confidently

**User Trust:**
- Transparent performance metrics build confidence
- Demonstrate continuous improvement over time
- Prove value proposition with hard numbers

**Operational Excellence:**
- Monitor production deployments
- Detect regressions before users complain
- Capacity planning based on growth trends

### Example Insights

**From Real Metrics:**

1. **Discovery:** "code.search_symbols p95 latency is 300ms"
   - **Action:** Profile and optimize vector search
   - **Result:** Reduce to 100ms, 3x improvement

2. **Discovery:** "Cache hit rate dropped from 0.8 to 0.6"
   - **Action:** Increase cache size from 100MB to 200MB
   - **Result:** Hit rate back to 0.78, 25% fewer disk reads

3. **Discovery:** "Token savings from SymbolExtraction: 40% of total"
   - **Action:** Promote this feature in documentation
   - **Result:** 15% increase in usage, more savings

4. **Discovery:** "Session completion rate: 0.65 (35% rollback/discard)"
   - **Action:** Investigate UX issues causing abandonment
   - **Result:** Improve session management UX

---

## Testing Strategy

### Unit Tests

**Histogram Tests:**
```rust
#[test]
fn test_histogram_quantile() {
    let mut hist = Histogram::new(LATENCY_BUCKETS);

    // Observe 1000 samples
    for i in 0..1000 {
        hist.observe((i as f64) / 1000.0);
    }

    assert_approx_eq!(hist.quantile(0.5), 0.5, 0.01);
    assert_approx_eq!(hist.quantile(0.95), 0.95, 0.01);
}

#[test]
fn test_atomic_counters() {
    let collector = MetricsCollector::new();

    // Simulate 100 concurrent tool calls
    let handles: Vec<_> = (0..100)
        .map(|_| {
            let c = collector.clone();
            tokio::spawn(async move {
                c.record_tool_execution(
                    "test.tool",
                    Duration::from_millis(10),
                    &Ok(()),
                    100,
                    200,
                );
            })
        })
        .collect();

    futures::future::join_all(handles).await;

    let snapshot = collector.snapshot_tool_metrics();
    assert_eq!(snapshot["test.tool"].total_calls, 100);
}
```

### Integration Tests

**End-to-End MCP Tool Test:**
```rust
#[tokio::test]
async fn test_metrics_get_tool_stats() {
    let system = setup_test_system().await;

    // Execute some tools to generate metrics
    for _ in 0..50 {
        system.execute_tool("code.search_symbols", json!({
            "query": "test",
            "detail_level": "interface"
        })).await.unwrap();
    }

    // Query metrics
    let result = system.execute_tool("metrics.get_tool_stats", json!({
        "tool_name": "code.search_symbols"
    })).await.unwrap();

    let stats = result["tools"][0].as_object().unwrap();
    assert_eq!(stats["total_calls"].as_u64().unwrap(), 50);
    assert!(stats["latency"]["avg_ms"].as_f64().unwrap() > 0.0);
}
```

### Performance Benchmarks

**Collection Overhead:**
```rust
#[bench]
fn bench_metrics_collection(b: &mut Bencher) {
    let collector = MetricsCollector::new();

    b.iter(|| {
        collector.record_tool_execution(
            "test.tool",
            Duration::from_millis(10),
            &Ok(()),
            100,
            200,
        );
    });
}

// Target: < 1 microsecond per collection
```

**Aggregation Performance:**
```rust
#[bench]
fn bench_aggregation(b: &mut Bencher) {
    let aggregator = setup_aggregator_with_1000_tools();

    b.iter(|| {
        futures::executor::block_on(aggregator.aggregate_and_flush())
    });
}

// Target: < 100ms for 1000 tools
```

---

## Prometheus Integration Example

### Grafana Dashboard JSON

```json
{
  "dashboard": {
    "title": "Meridian Metrics",
    "panels": [
      {
        "title": "Tool Latency (p95)",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, mcp_tool_duration_seconds_bucket)"
          }
        ],
        "type": "graph"
      },
      {
        "title": "Cache Hit Rate",
        "targets": [
          {
            "expr": "mcp_memory_cache_hit_rate"
          }
        ],
        "type": "gauge"
      },
      {
        "title": "Token Savings",
        "targets": [
          {
            "expr": "rate(mcp_tokens_saved_total[1h])"
          }
        ],
        "type": "graph"
      }
    ]
  }
}
```

### Prometheus Scrape Config

```yaml
scrape_configs:
  - job_name: 'meridian'
    static_configs:
      - targets: ['localhost:9090']
    metrics_path: '/metrics'
    scrape_interval: 60s
```

---

## Appendix: File Structure

```
meridian/
├── src/
│   ├── metrics/
│   │   ├── mod.rs              # Public API
│   │   ├── types.rs            # Data structures
│   │   ├── collector.rs        # Lock-free collection
│   │   ├── aggregator.rs       # Background aggregation
│   │   ├── storage.rs          # RocksDB schema
│   │   ├── prometheus.rs       # Prometheus export
│   │   ├── trends.rs           # Trend analysis
│   │   └── tests.rs            # Unit tests
│   │
│   └── mcp/
│       └── handlers.rs         # Modified with metrics hooks
│
├── tests/
│   └── metrics_integration_test.rs
│
├── benches/
│   └── metrics_bench.rs
│
└── docs/
    ├── metrics-guide.md        # User guide
    └── grafana-dashboards/     # Example dashboards
        └── meridian.json
```

---

## Conclusion

This specification defines a **production-grade metrics system** for Meridian that:

✅ **Follows industry best practices** (Prometheus, OpenTelemetry, Google SRE)
✅ **Zero performance impact** (lock-free, async, batched)
✅ **Comprehensive coverage** (tools, memory, search, sessions, tokens, system)
✅ **Token efficient** (progressive disclosure, smart filtering)
✅ **Actionable insights** (trends, anomalies, recommendations)
✅ **Production ready** (retention policies, Prometheus export, Grafana integration)

**Estimated Effort:** 28 hours
**Expected ROI:** 10x (optimization opportunities identified will far exceed implementation cost)

**Next Steps:**
1. Review and approve specification
2. Create detailed implementation tasks
3. Begin Phase 1 (infrastructure)
4. Iterate based on real usage data

---

**Document Version:** 1.0.0
**Author:** Claude (Sonnet 4.5)
**Date:** 2025-10-18
**Status:** Ready for Review
