# Meridian Self-Audit System Specification
**Automated Performance Analysis & Continuous Self-Improvement**

**Version**: 1.0.0
**Status**: Design Phase
**Last Updated**: October 18, 2025
**Author**: Meridian Team

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Vision & Philosophy](#vision--philosophy)
3. [Research Foundation](#research-foundation)
4. [Architecture Overview](#architecture-overview)
5. [Core Audit Modules](#core-audit-modules)
6. [Data Collection & Metrics](#data-collection--metrics)
7. [Audit Triggers & Scheduling](#audit-triggers--scheduling)
8. [Report Format Specification](#report-format-specification)
9. [Auto-Issue Creation](#auto-issue-creation)
10. [Self-Improvement Loop](#self-improvement-loop)
11. [MCP Tools Specification](#mcp-tools-specification)
12. [Storage Schema](#storage-schema)
13. [Implementation Plan](#implementation-plan)
14. [Testing Strategy](#testing-strategy)
15. [Success Metrics](#success-metrics)

---

## Executive Summary

### Problem Statement

Meridian is a complex, multi-layered cognitive memory system with 72+ MCP tools, ML inference pipelines, distributed indexing, and real-time file watching. **Without continuous self-monitoring, performance degradation and feature gaps go unnoticed until user complaints arise**.

**Current Reality**:
- No automated performance profiling
- Manual bottleneck identification
- Reactive bug fixing (not proactive)
- Unknown feature usage patterns
- No baseline comparison vs competitors (Sourcegraph, CodeSearch)
- Tech debt accumulates invisibly

### Solution: Self-Audit Subsystem

A **production-grade automated audit system** that continuously analyzes Meridian's performance, quality, usage patterns, and competitive positioning. Inspired by:

- **Google AutoML**: Continuous optimization loops with evolutionary improvement
- **Facebook SapFix**: Automated issue detection and fix generation
- **Netflix Chaos Engineering**: Continuous validation with automated experimentation
- **AWS Auto Scaling**: Metrics-driven automated adjustments

**Key Innovations**:

1. **Performance Profiler**: Real-time flame graphs, hot path detection, memory leak tracking
2. **Quality Analyzer**: Test coverage gaps, cyclomatic complexity, error rate analysis
3. **Usage Pattern Detector**: Feature utilization metrics, workflow mining, pain point inference
4. **Comparative Benchmarker**: Continuous benchmarks vs Sourcegraph baselines
5. **Auto-Issue Creator**: Automatically generates tasks in progress system with priority/severity
6. **Self-Improvement Loop**: Weekly full audits → prioritized tasks → measure improvements → adjust thresholds

### Expected Impact

- **Proactive bottleneck resolution**: Detect slow queries before users notice
- **Zero-drift quality**: Maintain 95%+ test coverage automatically
- **Data-driven roadmap**: Prioritize features based on usage analytics
- **Competitive awareness**: Always know our performance vs Sourcegraph/alternatives
- **Reduced maintenance burden**: Automated issue creation eliminates manual tracking

---

## Vision & Philosophy

### Design Principles

#### 1. **Continuous, Not Periodic**

Traditional code quality tools run on-demand. Meridian's audit system runs **continuously** in the background, collecting metrics every minute, profiling hourly, auditing daily, and generating comprehensive reports weekly.

```
Every Minute  → Collect: CPU, memory, query latency, error rates
Every Hour    → Profile: Flame graphs, hot paths, slow queries
Every Day     → Audit: Test coverage, code complexity, error patterns
Every Week    → Report: Full comparative analysis + auto-task creation
```

#### 2. **Self-Healing, Not Just Monitoring**

Inspired by SapFix, the audit system doesn't just **report problems** – it **creates actionable tasks** in the progress tracking system with:
- **Severity assignment** (critical/high/medium/low)
- **Automatic spec linking** (which spec section is impacted)
- **Suggested fixes** (based on past solutions from episodic memory)
- **Priority ranking** (business impact × technical difficulty)

#### 3. **Evolutionary, Not Static**

Like AutoML's evolutionary approach, audit thresholds **adapt over time**:

- **Initial baseline**: First week establishes baseline metrics
- **Progressive tightening**: As performance improves, thresholds become stricter
- **Regression detection**: Immediate alerts on performance degradation >5%
- **Trend analysis**: Identify gradual degradation (e.g., memory usage +2% per week)

#### 4. **Observable, Not Opaque**

All audit results are:
- **Stored in RocksDB** (audits persist, queryable history)
- **Exposed via MCP tools** (Claude Code can query audit status)
- **Linked to progress tasks** (every issue tracked end-to-end)
- **Visualizable** (JSON reports + flame graphs + dependency graphs)

---

## Research Foundation

### Google AutoML Insights

**Key Learnings**:
1. **Neural Architecture Search (NAS)**: Automatically search configuration space for optimal parameters
   - **Applied to Meridian**: Auto-tune HNSW parameters (M, efConstruction, efSearch) based on query latency
2. **Evolutionary Algorithms**: Continuously evolve models without human intervention
   - **Applied to Meridian**: Evolve cache sizes, batch sizes, reranker top-k based on workload patterns
3. **Hyperparameter Optimization**: Automated tuning with Bayesian optimization
   - **Applied to Meridian**: Optimize ML inference batch sizes, HNSW recall thresholds

**Implementation**:
```rust
struct AutoTuner {
    /// Bayesian optimizer for HNSW parameters
    fn tune_hnsw_params(&self, target_latency_ms: u64) -> HnswParams;

    /// Evolutionary search for cache sizes
    fn evolve_cache_config(&self, memory_budget: usize) -> CacheConfig;

    /// A/B testing for reranker top-k
    fn optimize_reranker_topk(&self, precision_target: f64) -> usize;
}
```

### Facebook SapFix Architecture

**Key Learnings**:
1. **Automated Fix Generation**: Template-based + mutation-based strategies
   - **Applied to Meridian**: Generate fixes for common performance issues (add caching, add index, optimize query)
2. **Human-in-the-Loop**: Suggest fixes, but require approval before deployment
   - **Applied to Meridian**: Create tasks with suggested solutions, not auto-apply
3. **Pattern Mining**: Learn from past human fixes
   - **Applied to Meridian**: Use episodic memory to suggest fixes based on similar issues

**Implementation**:
```rust
struct AutoFixer {
    /// Generate fix candidates for detected issue
    fn generate_fixes(&self, issue: &PerformanceIssue) -> Vec<FixCandidate>;

    /// Score fixes based on past success rate
    fn rank_fixes(&self, fixes: &[FixCandidate]) -> Vec<(FixCandidate, f64)>;

    /// Create task with top-ranked fix as suggestion
    fn create_task_with_suggestion(&self, issue: &Issue, fix: &FixCandidate) -> TaskId;
}
```

### Netflix Chaos Engineering Principles

**Key Learnings**:
1. **Continuous Validation**: Run experiments in production, continuously
   - **Applied to Meridian**: Continuous query latency monitoring, error rate tracking
2. **Automated Experimentation**: Inject failures to validate resilience
   - **Applied to Meridian**: Synthetic load testing, chaos queries (complex patterns)
3. **Steady State Hypothesis**: Define normal behavior, detect deviations
   - **Applied to Meridian**: Baseline metrics (p50, p95, p99 latency) with alerting on deviation

**Implementation**:
```rust
struct SteadyStateMonitor {
    /// Define baseline "normal" metrics
    fn establish_baseline(&self) -> BaselineMetrics;

    /// Detect deviation from baseline (>2 std dev)
    fn detect_anomaly(&self, current: &Metrics, baseline: &BaselineMetrics) -> Option<Anomaly>;

    /// Run synthetic chaos queries
    fn inject_chaos_query(&self) -> ChaosExperiment;
}
```

### AWS Auto Scaling Patterns

**Key Learnings**:
1. **Metrics-Driven Scaling**: CloudWatch metrics trigger automated actions
   - **Applied to Meridian**: Memory usage triggers cache eviction, CPU usage triggers batch size reduction
2. **Predictive Scaling**: Forecast load, scale preemptively
   - **Applied to Meridian**: Predict query patterns from time-of-day usage, pre-warm caches
3. **Target Tracking**: Maintain target metric (e.g., CPU @ 70%), auto-adjust resources
   - **Applied to Meridian**: Maintain target query latency (<50ms), auto-tune HNSW params

**Implementation**:
```rust
struct AutoScaler {
    /// Predict query load for next hour
    fn predict_load(&self, time_series: &[QueryMetric]) -> PredictedLoad;

    /// Adjust cache sizes to maintain target latency
    fn scale_to_target(&self, target_latency_ms: u64) -> CacheAdjustment;

    /// Pre-warm frequently accessed symbols
    fn prewarm_cache(&self, predicted_queries: &[String]);
}
```

---

## Architecture Overview

### High-Level Design

```
┌─────────────────────────────────────────────────────────────────┐
│                    MERIDIAN SELF-AUDIT SYSTEM                     │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐
│  Data Collectors │ ───> │  Audit Modules   │ ───> │  Issue Creator   │
│  (Continuous)    │      │  (Scheduled)     │      │  (Automated)     │
└──────────────────┘      └──────────────────┘      └──────────────────┘
        │                         │                         │
        │                         │                         │
        v                         v                         v
┌──────────────────────────────────────────────────────────────────┐
│                         ROCKSDB STORAGE                           │
│  metrics:{timestamp}   audits:{audit_id}   tasks:{task_id}       │
└──────────────────────────────────────────────────────────────────┘
        │                         │                         │
        │                         │                         │
        v                         v                         v
┌──────────────────────────────────────────────────────────────────┐
│                            MCP TOOLS                              │
│  audit.run_analysis()  audit.get_report()  audit.get_recs()      │
└──────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Frequency |
|-----------|---------------|-----------|
| **MetricsCollector** | Gather CPU, memory, query latency, error rates | Every minute |
| **PerformanceProfiler** | Flame graphs, hot paths, slow queries | Every hour |
| **QualityAnalyzer** | Test coverage, complexity, error patterns | Every day |
| **UsageDetector** | Feature usage, workflow mining | Every day |
| **ComparativeBenchmarker** | Benchmark vs Sourcegraph baselines | Every week |
| **IssueCreator** | Auto-generate tasks from findings | On audit completion |
| **AutoTuner** | Adjust parameters based on metrics | Every week |
| **ReportGenerator** | Create comprehensive audit reports | Every week |

---

## Core Audit Modules

### 1. Performance Profiler

**Purpose**: Identify CPU/memory/IO bottlenecks in real-time

#### 1.1 Hot Path Detection

```rust
use std::collections::HashMap;
use std::time::{Duration, Instant};

pub struct HotPath {
    pub function_name: String,
    pub file_path: String,
    pub line_number: u32,
    pub total_time_ms: u64,
    pub call_count: u64,
    pub avg_time_ms: f64,
    pub percentage_of_total: f64,
}

pub struct PerformanceProfiler {
    /// Collect stack traces every 10ms (100 Hz sampling)
    /// Build flame graph data structure
    pub fn profile_for_duration(&self, duration: Duration) -> FlameGraph {
        // Use cargo-flamegraph or similar
        unimplemented!()
    }

    /// Identify top-10 hottest code paths (>5% total time)
    pub fn analyze_hot_paths(&self, flame_graph: &FlameGraph) -> Vec<HotPath> {
        let mut hot_paths = Vec::new();

        // Parse flame graph, identify functions consuming >5% CPU
        // Return sorted by total_time_ms descending

        hot_paths
    }

    /// Detect CPU-bound vs IO-bound operations
    pub fn classify_bottleneck(&self, hot_path: &HotPath) -> BottleneckType {
        // Heuristics:
        // - If in async runtime code → IO-bound
        // - If in ML inference code → CPU-bound
        // - If in RocksDB read → IO-bound
        // - If in HNSW search → CPU-bound
        unimplemented!()
    }
}

pub enum BottleneckType {
    CpuBound,   // Add parallelism, optimize algorithm
    IoBound,    // Add caching, batch operations
    MemoryBound, // Reduce allocations, optimize data structures
}
```

#### 1.2 Slow Query Detection

```rust
use std::sync::Arc;
use parking_lot::RwLock;

pub struct SlowQuery {
    pub query_text: String,
    pub execution_time_ms: u64,
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub context: QueryContext,
}

pub struct QueryContext {
    pub mcp_tool: String,
    pub symbol_count: usize,
    pub file_count: usize,
    pub index_type: String, // "tantivy" | "hnsw" | "rocksdb"
}

pub struct SlowQueryDetector {
    threshold_ms: u64, // Default: 100ms
    slow_queries: Arc<RwLock<Vec<SlowQuery>>>,

    /// Record query execution time
    pub fn record_query(&self, query: &str, duration: Duration, context: QueryContext) {
        let duration_ms = duration.as_millis() as u64;

        if duration_ms > self.threshold_ms {
            let slow_query = SlowQuery {
                query_text: query.to_string(),
                execution_time_ms: duration_ms,
                timestamp: chrono::Utc::now(),
                context,
            };

            self.slow_queries.write().push(slow_query);
        }
    }

    /// Find all slow queries in last 24 hours
    pub fn find_slow_queries(&self, since: Duration) -> Vec<SlowQuery> {
        let cutoff = chrono::Utc::now() - chrono::Duration::from_std(since).unwrap();

        self.slow_queries
            .read()
            .iter()
            .filter(|q| q.timestamp > cutoff)
            .cloned()
            .collect()
    }

    /// Suggest optimizations for slow query
    pub fn suggest_optimization(&self, query: &SlowQuery) -> Vec<String> {
        let mut suggestions = Vec::new();

        // Heuristics based on query type
        if query.execution_time_ms > 200 && query.context.symbol_count > 10000 {
            suggestions.push("Add caching layer for frequently searched symbols".to_string());
        }

        if query.context.index_type == "tantivy" && query.execution_time_ms > 150 {
            suggestions.push("Consider adding index field for common query patterns".to_string());
        }

        if query.context.index_type == "hnsw" && query.execution_time_ms > 100 {
            suggestions.push("Increase efSearch parameter for better recall-latency tradeoff".to_string());
        }

        suggestions
    }
}
```

#### 1.3 Memory Leak Detection

```rust
use sysinfo::{System, SystemExt, ProcessExt};

pub struct MemorySnapshot {
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub rss_bytes: u64,        // Resident Set Size
    pub heap_bytes: u64,       // Heap allocation
    pub stack_bytes: u64,      // Stack usage
    pub mmap_bytes: u64,       // Memory-mapped files (RocksDB)
}

pub struct MemoryLeak {
    pub growth_rate_mb_per_hour: f64,
    pub suspected_component: String,
    pub evidence: Vec<String>,
    pub severity: Severity,
}

pub struct MemoryLeakDetector {
    snapshots: Vec<MemorySnapshot>,

    /// Take memory snapshot
    pub fn snapshot(&mut self) -> MemorySnapshot {
        let mut sys = System::new_all();
        sys.refresh_all();

        let process = sys.process(sysinfo::get_current_pid().unwrap()).unwrap();

        MemorySnapshot {
            timestamp: chrono::Utc::now(),
            rss_bytes: process.memory() * 1024, // Convert KB to bytes
            heap_bytes: 0, // TODO: Use jemalloc stats
            stack_bytes: 0,
            mmap_bytes: 0,
        }
    }

    /// Detect monotonic memory growth (potential leak)
    pub fn detect_memory_growth(&self) -> Option<MemoryLeak> {
        if self.snapshots.len() < 10 {
            return None; // Need at least 10 data points
        }

        // Linear regression on RSS over time
        let (slope, r_squared) = self.linear_regression();

        // Slope in bytes per second
        let growth_rate_mb_per_hour = (slope * 3600.0) / (1024.0 * 1024.0);

        // Alert if:
        // 1. Growth rate > 10 MB/hour
        // 2. R² > 0.8 (strong linear correlation → monotonic growth)
        if growth_rate_mb_per_hour > 10.0 && r_squared > 0.8 {
            Some(MemoryLeak {
                growth_rate_mb_per_hour,
                suspected_component: self.identify_suspect(),
                evidence: self.collect_evidence(),
                severity: if growth_rate_mb_per_hour > 50.0 {
                    Severity::Critical
                } else {
                    Severity::High
                },
            })
        } else {
            None
        }
    }

    fn linear_regression(&self) -> (f64, f64) {
        // Implement simple linear regression
        // Returns (slope, r_squared)
        unimplemented!()
    }

    fn identify_suspect(&self) -> String {
        // Heuristics:
        // - Check cache sizes
        // - Check session count
        // - Check file watcher state
        "Unknown".to_string()
    }

    fn collect_evidence(&self) -> Vec<String> {
        vec![
            format!("Memory snapshots: {} data points", self.snapshots.len()),
            "Analyze heap allocations with jemalloc profiler".to_string(),
        ]
    }
}
```

#### 1.4 CPU Bottleneck Detection

```rust
pub struct CpuBottleneck {
    pub function_name: String,
    pub cpu_percentage: f64,
    pub suggested_fix: String,
}

pub struct CpuProfiler {
    /// Detect functions consuming >20% CPU
    pub fn find_cpu_bottlenecks(&self, flame_graph: &FlameGraph) -> Vec<CpuBottleneck> {
        let mut bottlenecks = Vec::new();

        // Parse flame graph for CPU-heavy functions
        for node in flame_graph.nodes() {
            if node.cpu_percentage > 20.0 {
                bottlenecks.push(CpuBottleneck {
                    function_name: node.name.clone(),
                    cpu_percentage: node.cpu_percentage,
                    suggested_fix: self.suggest_cpu_optimization(&node),
                });
            }
        }

        bottlenecks
    }

    fn suggest_cpu_optimization(&self, node: &FlameGraphNode) -> String {
        if node.name.contains("hnsw_search") {
            "Consider reducing efSearch or using approximate search".to_string()
        } else if node.name.contains("rerank") {
            "Reduce reranking batch size or cache results".to_string()
        } else if node.name.contains("parse") {
            "Cache parsed ASTs for frequently accessed files".to_string()
        } else {
            "Profile with cargo flamegraph for detailed analysis".to_string()
        }
    }
}
```

---

### 2. Quality Analyzer

**Purpose**: Maintain code quality metrics (test coverage, complexity, error rates)

#### 2.1 Test Coverage Gap Detection

```rust
use std::collections::HashSet;

pub struct UncoveredPath {
    pub file_path: String,
    pub function_name: String,
    pub line_range: (u32, u32),
    pub complexity: u32, // Cyclomatic complexity
    pub priority: Priority,
}

pub struct TestCoverageAnalyzer {
    /// Run cargo-tarpaulin or similar to get coverage data
    pub fn analyze_coverage(&self) -> CoverageReport {
        // Execute: cargo tarpaulin --out Json
        // Parse results
        unimplemented!()
    }

    /// Find uncovered code paths
    pub fn find_untested_code(&self, coverage: &CoverageReport) -> Vec<UncoveredPath> {
        let mut uncovered = Vec::new();

        for file in &coverage.files {
            for function in &file.functions {
                if function.coverage_percentage < 80.0 {
                    uncovered.push(UncoveredPath {
                        file_path: file.path.clone(),
                        function_name: function.name.clone(),
                        line_range: function.line_range,
                        complexity: function.cyclomatic_complexity,
                        priority: self.calculate_priority(function),
                    });
                }
            }
        }

        uncovered
    }

    fn calculate_priority(&self, function: &FunctionCoverage) -> Priority {
        // High priority if:
        // - Public function (exported in MCP tools)
        // - High complexity (>10)
        // - Core module (indexer, memory, search)

        if function.is_public && function.cyclomatic_complexity > 10 {
            Priority::High
        } else if function.is_public {
            Priority::Medium
        } else {
            Priority::Low
        }
    }
}

pub struct CoverageReport {
    pub files: Vec<FileCoverage>,
    pub overall_percentage: f64,
}

pub struct FileCoverage {
    pub path: String,
    pub functions: Vec<FunctionCoverage>,
    pub coverage_percentage: f64,
}

pub struct FunctionCoverage {
    pub name: String,
    pub line_range: (u32, u32),
    pub coverage_percentage: f64,
    pub cyclomatic_complexity: u32,
    pub is_public: bool,
}
```

#### 2.2 Code Complexity Detection

```rust
pub struct ComplexFunction {
    pub file_path: String,
    pub function_name: String,
    pub cyclomatic_complexity: u32,
    pub cognitive_complexity: u32,
    pub loc: usize, // Lines of code
    pub refactoring_suggestion: String,
}

pub struct ComplexityAnalyzer {
    threshold: u32, // Default: 10

    /// Use cargo-cyclomatic or similar
    pub fn find_complex_functions(&self) -> Vec<ComplexFunction> {
        // Execute: cargo clippy -- -W clippy::cognitive_complexity
        // Parse results
        unimplemented!()
    }

    fn suggest_refactoring(&self, complexity: u32, loc: usize) -> String {
        if complexity > 20 {
            "Extract methods to reduce complexity below 15".to_string()
        } else if loc > 200 {
            "Split into smaller functions (<100 LOC each)".to_string()
        } else {
            "Simplify conditional logic or reduce nesting depth".to_string()
        }
    }
}
```

#### 2.3 Error Rate Analysis

```rust
pub struct ErrorPattern {
    pub error_type: String,
    pub count: u64,
    pub first_seen: chrono::DateTime<chrono::Utc>,
    pub last_seen: chrono::DateTime<chrono::Utc>,
    pub affected_tools: Vec<String>,
    pub sample_stack_trace: String,
}

pub struct ErrorAnalyzer {
    /// Parse application logs for error patterns
    pub fn analyze_error_patterns(&self, log_path: &str) -> Vec<ErrorPattern> {
        // Parse logs (JSON format from tracing-subscriber)
        // Group by error type
        // Count occurrences
        // Identify affected MCP tools
        unimplemented!()
    }

    /// Detect error rate spike (>2x baseline)
    pub fn detect_error_spike(&self, current: u64, baseline: u64) -> bool {
        current > baseline * 2
    }
}
```

#### 2.4 Dead Code Detection

```rust
pub struct DeadCode {
    pub file_path: String,
    pub item_type: String, // "function" | "struct" | "module"
    pub item_name: String,
    pub last_used: Option<chrono::DateTime<chrono::Utc>>,
    pub removal_candidate: bool,
}

pub struct DeadCodeDetector {
    /// Use cargo-udeps or cargo-machete
    pub fn find_unused_code(&self) -> Vec<DeadCode> {
        // Execute: cargo +nightly udeps
        // Parse results
        unimplemented!()
    }

    /// Check if function is called anywhere
    pub fn is_dead(&self, function_name: &str) -> bool {
        // Use tree-sitter to parse all files
        // Search for function calls
        unimplemented!()
    }
}
```

---

### 3. Usage Pattern Detector

**Purpose**: Understand how Meridian is actually used (data-driven roadmap)

#### 3.1 Feature Usage Tracking

```rust
pub struct FeatureUsage {
    pub mcp_tool: String,
    pub call_count: u64,
    pub unique_users: u64, // If multi-user (future)
    pub avg_execution_time_ms: f64,
    pub success_rate: f64,
    pub last_30_days_trend: Trend, // Increasing | Stable | Decreasing
}

pub enum Trend {
    Increasing(f64), // Growth rate %
    Stable,
    Decreasing(f64), // Decline rate %
}

pub struct UsageTracker {
    /// Track every MCP tool invocation
    pub fn record_invocation(&self, tool: &str, duration: Duration, success: bool) {
        // Store in RocksDB: usage:{date}:{tool} → count
    }

    /// Find underutilized features (<1% of total calls)
    pub fn find_underused_features(&self) -> Vec<FeatureUsage> {
        let total_calls = self.get_total_calls();

        let mut underused = Vec::new();

        for tool in self.get_all_tools() {
            let usage = self.get_usage(&tool);

            let usage_percentage = (usage.call_count as f64 / total_calls as f64) * 100.0;

            if usage_percentage < 1.0 {
                underused.push(usage);
            }
        }

        underused
    }

    /// Analyze tool usage trends
    pub fn analyze_trends(&self, tool: &str) -> Trend {
        let last_30_days = self.get_usage_last_n_days(tool, 30);
        let previous_30_days = self.get_usage_days_ago(tool, 30, 60);

        let growth_rate = ((last_30_days as f64 - previous_30_days as f64) / previous_30_days as f64) * 100.0;

        if growth_rate > 10.0 {
            Trend::Increasing(growth_rate)
        } else if growth_rate < -10.0 {
            Trend::Decreasing(growth_rate.abs())
        } else {
            Trend::Stable
        }
    }
}
```

#### 3.2 Workflow Pattern Mining

```rust
pub struct WorkflowPattern {
    pub sequence: Vec<String>, // Sequence of MCP tool calls
    pub frequency: u64,
    pub avg_time_between_calls_ms: Vec<u64>,
    pub success_rate: f64,
}

pub struct WorkflowMiner {
    /// Mine common sequences of tool calls
    pub fn extract_common_patterns(&self, min_support: f64) -> Vec<WorkflowPattern> {
        // Sequence mining algorithm (e.g., PrefixSpan)
        // Find patterns that occur in >min_support% of sessions

        // Example patterns:
        // 1. code.search_symbols → code.get_definition → progress.mark_complete
        // 2. specs.get_section → code.search_symbols → progress.create_task
        // 3. session.begin → code.get_dependencies → session.update → session.complete

        unimplemented!()
    }

    /// Identify inefficient workflows (high time, low success)
    pub fn find_pain_points(&self) -> Vec<WorkflowPattern> {
        self.extract_common_patterns(0.05)
            .into_iter()
            .filter(|p| p.success_rate < 0.8) // <80% success
            .collect()
    }
}
```

#### 3.3 Missing Feature Inference

```rust
pub struct FeatureGap {
    pub inferred_need: String,
    pub evidence: Vec<String>,
    pub suggested_tool: String,
    pub priority: Priority,
}

pub struct FeatureGapAnalyzer {
    /// Infer missing features from user behavior
    pub fn infer_missing_features(&self) -> Vec<FeatureGap> {
        let mut gaps = Vec::new();

        // Example heuristics:
        // - If users frequently call code.search_symbols + code.get_definition in sequence
        //   → Suggest: "code.search_with_definition" (combined tool)

        // - If users manually query multiple projects in sequence
        //   → Suggest: "global.search_all" (cross-project search)

        // - If users repeatedly call progress.list_tasks with same filters
        //   → Suggest: "progress.create_saved_filter"

        gaps
    }
}
```

#### 3.4 Parameter Usage Analysis

```rust
pub struct ParameterInsight {
    pub tool_name: String,
    pub parameter_name: String,
    pub usage_histogram: HashMap<String, u64>, // value → count
    pub default_override_rate: f64, // % of calls using non-default value
    pub unused: bool, // True if always uses default
}

pub struct ParameterAnalyzer {
    /// Analyze how tool parameters are actually used
    pub fn analyze_parameter_usage(&self, tool: &str) -> Vec<ParameterInsight> {
        // For each tool parameter:
        // - Track value distribution
        // - Detect if always default (candidates for removal)
        // - Detect if narrow range (optimize for common case)

        unimplemented!()
    }
}
```

---

### 4. Comparative Benchmarker

**Purpose**: Continuous benchmarking vs Sourcegraph and other code search tools

#### 4.1 Benchmark Suite

```rust
pub struct Benchmark {
    pub name: String,
    pub query: String,
    pub corpus_size: usize, // Number of files
    pub expected_result_count: usize,
}

pub struct ComparisonReport {
    pub meridian_result: BenchmarkResult,
    pub sourcegraph_result: BenchmarkResult,
    pub winner: String,
    pub delta_percentage: f64,
}

pub struct BenchmarkResult {
    pub latency_p50_ms: f64,
    pub latency_p95_ms: f64,
    pub latency_p99_ms: f64,
    pub memory_mb: f64,
    pub recall: f64, // % of expected results found
    pub precision: f64, // % of results that are relevant
}

pub struct ComparativeBenchmarker {
    benchmarks: Vec<Benchmark>,

    /// Run benchmark suite against Meridian
    pub fn run_meridian_benchmarks(&self) -> Vec<BenchmarkResult> {
        // Execute queries via MCP tools
        // Measure latency, memory, recall
        unimplemented!()
    }

    /// Compare search performance vs Sourcegraph baseline
    pub fn compare_search_performance(&self) -> ComparisonReport {
        // Benchmark 1: Simple symbol search ("HashMap")
        // Benchmark 2: Complex query ("async function returning Result")
        // Benchmark 3: Cross-file reference search
        // Benchmark 4: Dependency graph query

        // Compare:
        // - Search latency (Meridian should be faster)
        // - Memory usage (Meridian should be more efficient)
        // - Result quality (Meridian should have better recall/precision)

        unimplemented!()
    }

    /// Compare memory efficiency vs Sourcegraph
    pub fn compare_memory_usage(&self) -> ComparisonReport {
        // Measure:
        // - Index size on disk
        // - RSS memory during query
        // - Cache memory usage

        unimplemented!()
    }

    /// Check feature parity with Sourcegraph
    pub fn check_feature_parity(&self) -> Vec<MissingFeature> {
        let sourcegraph_features = vec![
            "Batch Changes",
            "Code Insights",
            "Precise Code Intel (LSIF)",
            "Code Monitors",
            "Saved Searches",
        ];

        let mut missing = Vec::new();

        for feature in sourcegraph_features {
            if !self.has_equivalent(feature) {
                missing.push(MissingFeature {
                    name: feature.to_string(),
                    priority: Priority::Medium,
                    estimated_effort: "4-8 weeks".to_string(),
                });
            }
        }

        missing
    }

    fn has_equivalent(&self, feature: &str) -> bool {
        match feature {
            "Batch Changes" => false, // No equivalent yet
            "Code Insights" => true,  // We have usage analytics
            "Precise Code Intel" => true, // We have tree-sitter parsing
            "Code Monitors" => false, // No file watching yet (TODO)
            "Saved Searches" => false, // No saved queries yet
            _ => false,
        }
    }

    /// Detect performance regressions
    pub fn detect_regressions(&self) -> Vec<Regression> {
        let baseline = self.load_baseline_results();
        let current = self.run_meridian_benchmarks();

        let mut regressions = Vec::new();

        for (i, bench) in self.benchmarks.iter().enumerate() {
            let baseline_p95 = baseline[i].latency_p95_ms;
            let current_p95 = current[i].latency_p95_ms;

            let degradation = ((current_p95 - baseline_p95) / baseline_p95) * 100.0;

            if degradation > 5.0 {
                regressions.push(Regression {
                    benchmark_name: bench.name.clone(),
                    metric: "latency_p95_ms".to_string(),
                    baseline_value: baseline_p95,
                    current_value: current_p95,
                    degradation_percentage: degradation,
                    severity: if degradation > 20.0 { Severity::Critical } else { Severity::High },
                });
            }
        }

        regressions
    }

    fn load_baseline_results(&self) -> Vec<BenchmarkResult> {
        // Load from RocksDB: benchmarks:baseline → Vec<BenchmarkResult>
        unimplemented!()
    }
}

pub struct Regression {
    pub benchmark_name: String,
    pub metric: String,
    pub baseline_value: f64,
    pub current_value: f64,
    pub degradation_percentage: f64,
    pub severity: Severity,
}

pub struct MissingFeature {
    pub name: String,
    pub priority: Priority,
    pub estimated_effort: String,
}
```

---

### 5. Auto-Issue Creator

**Purpose**: Automatically create tasks in progress system from audit findings

```rust
use crate::progress::types::{Task, TaskStatus, Priority};
use uuid::Uuid;

pub struct IssueCreator {
    progress_manager: Arc<ProgressManager>,

    /// Create tasks for all detected issues
    pub async fn create_performance_tasks(&self, issues: Vec<PerformanceIssue>) -> Vec<Uuid> {
        let mut task_ids = Vec::new();

        for issue in issues {
            let task_id = self.create_task_from_issue(&issue).await;
            task_ids.push(task_id);
        }

        task_ids
    }

    async fn create_task_from_issue(&self, issue: &PerformanceIssue) -> Uuid {
        let priority = self.assign_priority(issue);
        let spec_ref = self.link_to_spec(issue);

        let task = Task {
            task_id: Uuid::new_v4(),
            title: issue.title.clone(),
            description: issue.description.clone(),
            status: TaskStatus::Pending,
            priority,
            estimated_hours: issue.estimated_hours,
            actual_hours: None,
            tags: issue.tags.clone(),
            spec_ref,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            completed_at: None,
            commit_hash: None,
        };

        self.progress_manager.create_task(task).await.unwrap();
        task.task_id
    }

    /// Assign priority based on severity and impact
    fn assign_priority(&self, issue: &PerformanceIssue) -> Priority {
        match issue.severity {
            Severity::Critical => Priority::Critical,
            Severity::High => Priority::High,
            Severity::Medium => Priority::Medium,
            Severity::Low => Priority::Low,
        }
    }

    /// Link issue to relevant spec section
    fn link_to_spec(&self, issue: &PerformanceIssue) -> Option<SpecReference> {
        // Heuristics:
        // - If issue.location contains "indexer" → spec.md#indexer
        // - If issue.location contains "hnsw" → spec.md#vector-indexing
        // - If issue.location contains "mcp" → spec.md#mcp-tools

        if issue.location.contains("indexer") {
            Some(SpecReference {
                spec_name: "spec".to_string(),
                section: "Code Indexer".to_string(),
            })
        } else if issue.location.contains("hnsw") {
            Some(SpecReference {
                spec_name: "spec".to_string(),
                section: "Vector Indexing (HNSW)".to_string(),
            })
        } else {
            None
        }
    }
}

pub struct PerformanceIssue {
    pub title: String,
    pub description: String,
    pub severity: Severity,
    pub location: String, // File path or component
    pub suggested_fix: String,
    pub estimated_hours: Option<f64>,
    pub tags: Vec<String>,
}

pub enum Severity {
    Critical, // Service degraded, user-facing impact
    High,     // Performance issue, but functional
    Medium,   // Optimization opportunity
    Low,      // Nice-to-have improvement
}

#[derive(Clone)]
pub struct SpecReference {
    pub spec_name: String,
    pub section: String,
}
```

---

## Data Collection & Metrics

### Metrics Schema

```rust
pub struct MetricsSnapshot {
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub cpu: CpuMetrics,
    pub memory: MemoryMetrics,
    pub queries: QueryMetrics,
    pub errors: ErrorMetrics,
    pub mcp: McpMetrics,
}

pub struct CpuMetrics {
    pub usage_percentage: f64,
    pub load_average: (f64, f64, f64), // 1min, 5min, 15min
    pub thread_count: usize,
}

pub struct MemoryMetrics {
    pub rss_mb: f64,
    pub heap_mb: f64,
    pub cache_mb: f64,
    pub rocksdb_mb: f64,
}

pub struct QueryMetrics {
    pub total_queries: u64,
    pub p50_latency_ms: f64,
    pub p95_latency_ms: f64,
    pub p99_latency_ms: f64,
    pub slow_query_count: u64, // >100ms
}

pub struct ErrorMetrics {
    pub total_errors: u64,
    pub error_rate: f64, // errors per 1000 queries
    pub by_type: HashMap<String, u64>,
}

pub struct McpMetrics {
    pub total_tool_calls: u64,
    pub success_rate: f64,
    pub by_tool: HashMap<String, ToolMetrics>,
}

pub struct ToolMetrics {
    pub call_count: u64,
    pub success_count: u64,
    pub avg_latency_ms: f64,
}
```

---

## Audit Triggers & Scheduling

### Trigger System

```rust
use tokio::time::{interval, Duration};

pub struct AuditScheduler {
    /// Collect metrics every minute
    pub async fn run_continuous_collection(&self) {
        let mut interval = interval(Duration::from_secs(60));

        loop {
            interval.tick().await;
            self.collect_metrics().await;
        }
    }

    /// Run performance profiling every hour
    pub async fn run_hourly_profiling(&self) {
        let mut interval = interval(Duration::from_secs(3600));

        loop {
            interval.tick().await;
            self.run_performance_profile().await;
        }
    }

    /// Run full quality audit daily at 2 AM
    pub async fn run_daily_audit(&self) {
        loop {
            let now = chrono::Local::now();
            let next_run = now.date_naive().succ_opt().unwrap().and_hms_opt(2, 0, 0).unwrap();
            let duration_until = (next_run.and_utc() - now.naive_utc().and_utc()).to_std().unwrap();

            tokio::time::sleep(duration_until).await;
            self.run_quality_audit().await;
        }
    }

    /// Run comprehensive weekly audit (Sundays at midnight)
    pub async fn run_weekly_comprehensive_audit(&self) {
        loop {
            let now = chrono::Local::now();
            let days_until_sunday = (7 - now.weekday().num_days_from_sunday()) % 7;
            let next_sunday = now.date_naive().checked_add_days(chrono::Days::new(days_until_sunday as u64)).unwrap();
            let next_run = next_sunday.and_hms_opt(0, 0, 0).unwrap();
            let duration_until = (next_run.and_utc() - now.naive_utc().and_utc()).to_std().unwrap();

            tokio::time::sleep(duration_until).await;
            self.run_comprehensive_audit().await;
        }
    }

    async fn collect_metrics(&self) {
        // Collect CPU, memory, query stats
    }

    async fn run_performance_profile(&self) {
        // Run flamegraph profiling
    }

    async fn run_quality_audit(&self) {
        // Run test coverage, complexity analysis
    }

    async fn run_comprehensive_audit(&self) {
        // Run all audit modules + generate report + create tasks
    }
}
```

### On-Demand Audits

```rust
pub enum AuditScope {
    Performance,
    Quality,
    Usage,
    Comparative,
    Full,
}

impl AuditScheduler {
    /// Run audit on-demand via MCP tool
    pub async fn run_audit(&self, scope: AuditScope) -> AuditReport {
        match scope {
            AuditScope::Performance => self.audit_performance().await,
            AuditScope::Quality => self.audit_quality().await,
            AuditScope::Usage => self.audit_usage().await,
            AuditScope::Comparative => self.audit_comparative().await,
            AuditScope::Full => self.audit_full().await,
        }
    }
}
```

---

## Report Format Specification

### Comprehensive Audit Report

```json
{
  "audit_id": "audit_2025_10_18_001",
  "timestamp": "2025-10-18T20:00:00Z",
  "scope": "full",
  "version": "0.1.0",

  "summary": {
    "overall_health": "good",
    "critical_issues": 0,
    "high_issues": 2,
    "medium_issues": 5,
    "low_issues": 3,
    "tasks_created": 10,
    "improvement_opportunities": 8
  },

  "findings": {
    "performance": {
      "severity": "medium",
      "issues": [
        {
          "id": "perf_001",
          "type": "slow_query",
          "location": "src/indexer/code_indexer.rs:234",
          "description": "Symbol search taking 150ms avg (target: <50ms)",
          "impact": "high",
          "evidence": {
            "p50_latency_ms": 120,
            "p95_latency_ms": 180,
            "p99_latency_ms": 250,
            "sample_count": 1247
          },
          "suggested_fix": "Add LRU cache (10k entries) for frequently searched symbols. Expected improvement: -60% latency",
          "estimated_hours": 4,
          "task_created": "task_abc123"
        },
        {
          "id": "perf_002",
          "type": "memory_growth",
          "location": "src/indexer/watcher.rs",
          "description": "Memory growing at 12 MB/hour (potential leak in file watcher)",
          "impact": "high",
          "evidence": {
            "growth_rate_mb_per_hour": 12.3,
            "r_squared": 0.89,
            "data_points": 48
          },
          "suggested_fix": "Audit file watcher state cleanup. Check for unbounded Vec growth in event queue",
          "estimated_hours": 6,
          "task_created": "task_def456"
        }
      ],
      "hot_paths": [
        {
          "function": "hnsw_rs::search",
          "cpu_percentage": 23.5,
          "avg_time_ms": 45,
          "bottleneck_type": "cpu_bound",
          "optimization": "Reduce efSearch from 200 to 100 for 2x speedup (minor recall loss)"
        }
      ]
    },

    "quality": {
      "severity": "low",
      "test_coverage": {
        "overall_percentage": 97.2,
        "target": 95.0,
        "status": "✅ PASS"
      },
      "uncovered_functions": [
        {
          "file": "src/audit/auto_tuner.rs",
          "function": "tune_hnsw_params",
          "lines": "45-67",
          "complexity": 8,
          "priority": "medium",
          "task_created": "task_ghi789"
        }
      ],
      "complex_functions": [
        {
          "file": "src/mcp/handlers.rs",
          "function": "handle_code_search",
          "cyclomatic_complexity": 15,
          "cognitive_complexity": 22,
          "loc": 145,
          "suggestion": "Extract parameter validation and result formatting into separate functions",
          "task_created": "task_jkl012"
        }
      ],
      "error_patterns": [
        {
          "type": "anyhow::Error: File not found",
          "count": 37,
          "first_seen": "2025-10-17T10:23:45Z",
          "last_seen": "2025-10-18T18:12:33Z",
          "affected_tools": ["code.get_definition", "code.find_references"],
          "severity": "medium",
          "suggestion": "Add graceful handling for deleted files in index"
        }
      ],
      "dead_code": {
        "total_loc": 127,
        "items": [
          {
            "type": "function",
            "name": "legacy_parse_file",
            "file": "src/indexer/parser.rs",
            "removal_candidate": true
          }
        ]
      }
    },

    "usage": {
      "severity": "info",
      "feature_usage": [
        {
          "tool": "code.search_symbols",
          "call_count": 12458,
          "percentage_of_total": 28.4,
          "avg_latency_ms": 42,
          "success_rate": 0.98,
          "trend": "increasing_15_percent"
        },
        {
          "tool": "context.defragment",
          "call_count": 12,
          "percentage_of_total": 0.03,
          "avg_latency_ms": 234,
          "success_rate": 0.83,
          "trend": "stable",
          "underutilized": true,
          "recommendation": "Promote feature in docs or consider deprecation"
        }
      ],
      "common_patterns": [
        {
          "sequence": ["code.search_symbols", "code.get_definition", "progress.mark_complete"],
          "frequency": 234,
          "avg_duration_sec": 12.5,
          "success_rate": 0.96,
          "optimization": "Consider combined tool: code.search_with_definition"
        }
      ],
      "inferred_gaps": [
        {
          "need": "Batch symbol search (search multiple symbols in one call)",
          "evidence": [
            "Users call code.search_symbols 5+ times in <10 seconds",
            "Pattern observed in 47% of sessions"
          ],
          "suggested_tool": "code.batch_search_symbols",
          "priority": "high",
          "estimated_hours": 8
        }
      ]
    },

    "comparative": {
      "severity": "info",
      "vs_sourcegraph": {
        "search_speed": {
          "meridian_p95_ms": 45,
          "sourcegraph_p95_ms": 120,
          "delta": "+166% faster",
          "status": "✅ WIN"
        },
        "memory_usage": {
          "meridian_rss_mb": 512,
          "sourcegraph_rss_mb": 890,
          "delta": "+42% more efficient",
          "status": "✅ WIN"
        },
        "index_size": {
          "meridian_gb": 2.3,
          "sourcegraph_gb": 3.8,
          "delta": "+39% smaller",
          "status": "✅ WIN"
        },
        "missing_features": [
          {
            "name": "Batch Changes",
            "priority": "low",
            "estimated_effort": "6-8 weeks",
            "value": "Low (outside core use case)"
          },
          {
            "name": "Code Monitors",
            "priority": "medium",
            "estimated_effort": "2-3 weeks",
            "value": "Medium (file watching can enable this)"
          }
        ]
      },
      "regressions": []
    }
  },

  "tasks_created": [
    {
      "task_id": "task_abc123",
      "title": "Optimize symbol search with LRU caching",
      "priority": "high",
      "estimated_hours": 4,
      "spec_ref": {
        "spec_name": "spec",
        "section": "Code Indexer"
      }
    },
    {
      "task_id": "task_def456",
      "title": "Fix memory leak in file watcher",
      "priority": "high",
      "estimated_hours": 6,
      "spec_ref": {
        "spec_name": "spec",
        "section": "Auto-Update System"
      }
    }
  ],

  "recommendations": [
    {
      "category": "performance",
      "priority": "high",
      "action": "Add symbol search caching layer",
      "expected_impact": "60% latency reduction"
    },
    {
      "category": "quality",
      "priority": "medium",
      "action": "Refactor handle_code_search to reduce complexity",
      "expected_impact": "Improved maintainability"
    },
    {
      "category": "feature",
      "priority": "high",
      "action": "Implement code.batch_search_symbols",
      "expected_impact": "Better UX for multi-symbol searches"
    }
  ],

  "baseline_comparison": {
    "previous_audit": "audit_2025_10_11_001",
    "improvements": [
      {
        "metric": "test_coverage",
        "previous": 95.1,
        "current": 97.2,
        "delta": "+2.1%"
      },
      {
        "metric": "query_p95_latency_ms",
        "previous": 52,
        "current": 45,
        "delta": "-13.5%"
      }
    ],
    "regressions": []
  }
}
```

---

## Auto-Issue Creation

### Workflow

```
Audit Detection → Severity Assessment → Spec Linking → Task Creation → Episode Recording
```

### Task Template Generation

```rust
impl IssueCreator {
    fn generate_task_from_finding(&self, finding: &Finding) -> Task {
        let title = match finding.type_ {
            FindingType::SlowQuery => format!("Optimize slow query: {}", finding.location),
            FindingType::MemoryLeak => format!("Fix memory leak in {}", finding.location),
            FindingType::TestCoverage => format!("Add tests for {}", finding.location),
            FindingType::Complexity => format!("Refactor complex function: {}", finding.location),
            FindingType::MissingFeature => format!("Implement feature: {}", finding.description),
        };

        let description = format!(
            "{}\n\n**Impact**: {}\n\n**Evidence**:\n{}\n\n**Suggested Fix**:\n{}\n\n**Automated Audit ID**: {}",
            finding.description,
            finding.impact,
            finding.evidence,
            finding.suggested_fix,
            finding.audit_id
        );

        let tags = vec![
            "automated-audit".to_string(),
            finding.category.clone(),
            finding.severity.to_string().to_lowercase(),
        ];

        Task {
            task_id: Uuid::new_v4(),
            title,
            description,
            status: TaskStatus::Pending,
            priority: finding.severity.into(),
            estimated_hours: finding.estimated_hours,
            tags,
            spec_ref: self.link_to_spec(finding),
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            ..Default::default()
        }
    }
}
```

---

## Self-Improvement Loop

### Weekly Cycle

```
Sunday 00:00: Run comprehensive audit
           ↓
Sunday 00:30: Generate report + create tasks
           ↓
Sunday 01:00: Update roadmap priorities (high-severity tasks)
           ↓
During Week: Tasks completed by humans/AI
           ↓
Next Sunday: Measure improvement vs baseline
           ↓
Adjust thresholds: If performance improving, tighten thresholds
```

### Adaptive Thresholds

```rust
pub struct AdaptiveThresholds {
    pub slow_query_threshold_ms: u64,
    pub memory_growth_threshold_mb_per_hour: f64,
    pub test_coverage_target: f64,
    pub complexity_threshold: u32,

    /// Adjust thresholds based on performance trends
    pub fn adjust_based_on_performance(&mut self, current: &Metrics, baseline: &Metrics) {
        // If query latency improved by >10%, tighten threshold
        if current.p95_latency_ms < baseline.p95_latency_ms * 0.9 {
            self.slow_query_threshold_ms = (self.slow_query_threshold_ms as f64 * 0.95) as u64;
        }

        // If test coverage increased, raise target
        if current.test_coverage > baseline.test_coverage {
            self.test_coverage_target = (current.test_coverage + 0.5).min(99.0);
        }
    }
}
```

---

## MCP Tools Specification

### 1. `audit.run_analysis`

**Purpose**: Run audit on-demand

```json
{
  "name": "audit.run_analysis",
  "description": "Run automated audit analysis (performance, quality, usage, or full)",
  "inputSchema": {
    "type": "object",
    "properties": {
      "scope": {
        "type": "string",
        "enum": ["performance", "quality", "usage", "comparative", "full"],
        "description": "Audit scope to run"
      },
      "create_tasks": {
        "type": "boolean",
        "default": true,
        "description": "Automatically create tasks for findings"
      }
    },
    "required": ["scope"]
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "audit_id": { "type": "string" },
      "findings_count": { "type": "number" },
      "tasks_created": { "type": "number" },
      "report_summary": { "type": "string" }
    }
  }
}
```

**Example**:
```typescript
const result = await mcp__meridian__audit_run_analysis({
  scope: "performance",
  create_tasks: true
});
// Returns: { audit_id: "audit_2025_10_18_002", findings_count: 3, tasks_created: 2 }
```

---

### 2. `audit.get_report`

**Purpose**: Retrieve audit report (full JSON)

```json
{
  "name": "audit.get_report",
  "description": "Get complete audit report by ID (or latest if omitted)",
  "inputSchema": {
    "type": "object",
    "properties": {
      "audit_id": {
        "type": "string",
        "description": "Audit ID (omit for latest)"
      },
      "format": {
        "type": "string",
        "enum": ["json", "summary"],
        "default": "summary"
      }
    }
  }
}
```

---

### 3. `audit.list_findings`

**Purpose**: Query findings with filters

```json
{
  "name": "audit.list_findings",
  "description": "List audit findings with optional filters",
  "inputSchema": {
    "type": "object",
    "properties": {
      "severity": {
        "type": "string",
        "enum": ["critical", "high", "medium", "low"]
      },
      "type": {
        "type": "string",
        "enum": ["slow_query", "memory_leak", "test_coverage", "complexity", "missing_feature"]
      },
      "limit": {
        "type": "number",
        "default": 20
      }
    }
  }
}
```

---

### 4. `audit.get_recommendations`

**Purpose**: Get actionable recommendations from latest audit

```json
{
  "name": "audit.get_recommendations",
  "description": "Get prioritized recommendations from audit results",
  "inputSchema": {
    "type": "object",
    "properties": {
      "category": {
        "type": "string",
        "enum": ["performance", "quality", "feature", "all"],
        "default": "all"
      },
      "top_n": {
        "type": "number",
        "default": 5
      }
    }
  }
}
```

---

### 5. `audit.get_baseline`

**Purpose**: Get baseline metrics for comparison

```json
{
  "name": "audit.get_baseline",
  "description": "Get baseline performance metrics",
  "outputSchema": {
    "type": "object",
    "properties": {
      "established_at": { "type": "string" },
      "metrics": {
        "type": "object",
        "properties": {
          "p95_latency_ms": { "type": "number" },
          "test_coverage": { "type": "number" },
          "memory_mb": { "type": "number" }
        }
      }
    }
  }
}
```

---

### 6. `audit.update_thresholds`

**Purpose**: Manually adjust audit thresholds

```json
{
  "name": "audit.update_thresholds",
  "description": "Update audit detection thresholds",
  "inputSchema": {
    "type": "object",
    "properties": {
      "slow_query_ms": { "type": "number" },
      "memory_growth_mb_per_hour": { "type": "number" },
      "test_coverage_target": { "type": "number" },
      "complexity_threshold": { "type": "number" }
    }
  }
}
```

---

## Storage Schema

### RocksDB Keys

```
# Metrics (time-series data)
metrics:{timestamp}           → MetricsSnapshot

# Audit reports
audits:{audit_id}             → AuditReport
audits:latest                 → audit_id (pointer to latest)
audits:index:date:{YYYY-MM-DD} → Vec<audit_id>

# Findings
findings:{finding_id}         → Finding
findings:index:severity:{severity} → Vec<finding_id>
findings:index:type:{type}    → Vec<finding_id>
findings:index:audit:{audit_id} → Vec<finding_id>

# Baselines
baseline:performance          → BaselineMetrics
baseline:history              → Vec<(timestamp, BaselineMetrics)>

# Thresholds
thresholds:current            → AdaptiveThresholds
thresholds:history            → Vec<(timestamp, AdaptiveThresholds)>

# Benchmarks
benchmarks:baseline           → Vec<BenchmarkResult>
benchmarks:latest             → Vec<BenchmarkResult>
benchmarks:history:{YYYY-MM-DD} → Vec<BenchmarkResult>
```

---

## Implementation Plan

### Phase 1: Infrastructure & Metrics Collection (Week 1, 16h)

**Tasks**:
1. Create `src/audit/` module structure (2h)
2. Implement `MetricsCollector` with sysinfo integration (4h)
3. Implement metrics storage in RocksDB (3h)
4. Add metrics collection to MCP server startup (2h)
5. Create basic dashboard (CLI tool to view metrics) (5h)

**Deliverables**:
- ✅ Continuous metrics collection (CPU, memory, queries)
- ✅ RocksDB storage schema
- ✅ CLI: `meridian audit metrics --last 1h`

---

### Phase 2: Performance Profiler (Week 2, 20h)

**Tasks**:
1. Implement `SlowQueryDetector` with query instrumentation (6h)
2. Integrate flamegraph profiling (cargo-flamegraph wrapper) (5h)
3. Implement `HotPathAnalyzer` (parse flamegraph JSON) (4h)
4. Implement `MemoryLeakDetector` with linear regression (5h)

**Deliverables**:
- ✅ Slow query detection (>100ms threshold)
- ✅ Hourly flamegraph profiling
- ✅ Memory leak detection with alerts

---

### Phase 3: Quality Analyzer (Week 3, 18h)

**Tasks**:
1. Implement `TestCoverageAnalyzer` (cargo-tarpaulin integration) (5h)
2. Implement `ComplexityAnalyzer` (cargo-cyclomatic integration) (4h)
3. Implement `ErrorAnalyzer` (parse JSON logs) (4h)
4. Implement `DeadCodeDetector` (cargo-udeps integration) (5h)

**Deliverables**:
- ✅ Test coverage tracking
- ✅ Complexity detection (>10 threshold)
- ✅ Error pattern analysis

---

### Phase 4: Usage Pattern Detector (Week 4, 16h)

**Tasks**:
1. Implement `UsageTracker` (track MCP tool calls) (4h)
2. Implement `WorkflowMiner` (sequence mining with PrefixSpan) (6h)
3. Implement `FeatureGapAnalyzer` (heuristic-based inference) (4h)
4. Implement `ParameterAnalyzer` (track parameter usage) (2h)

**Deliverables**:
- ✅ Feature usage analytics
- ✅ Workflow pattern mining
- ✅ Missing feature inference

---

### Phase 5: Comparative Benchmarker (Week 5, 20h)

**Tasks**:
1. Define benchmark suite (10 representative queries) (3h)
2. Implement `BenchmarkRunner` for Meridian (4h)
3. Research Sourcegraph performance baselines (literature/docs) (3h)
4. Implement `ComparativeAnalyzer` (5h)
5. Implement `RegressionDetector` (5h)

**Deliverables**:
- ✅ Automated benchmarking vs Sourcegraph
- ✅ Regression detection (>5% degradation)

---

### Phase 6: Auto-Issue Creator (Week 6, 12h)

**Tasks**:
1. Implement `IssueCreator` with progress system integration (5h)
2. Implement severity assignment logic (2h)
3. Implement spec linking heuristics (3h)
4. Test end-to-end task creation (2h)

**Deliverables**:
- ✅ Automated task creation from findings
- ✅ Tasks linked to specs with priority/severity

---

### Phase 7: Self-Improvement Loop (Week 7, 14h)

**Tasks**:
1. Implement `AutoTuner` for HNSW parameters (6h)
2. Implement adaptive thresholds (4h)
3. Implement weekly audit scheduler (2h)
4. Test improvement cycle end-to-end (2h)

**Deliverables**:
- ✅ Automated parameter tuning
- ✅ Weekly comprehensive audits
- ✅ Threshold adaptation

---

### Phase 8: MCP Tools & Reporting (Week 8, 16h)

**Tasks**:
1. Implement 6 MCP audit tools (10h)
2. Implement `ReportGenerator` (JSON format) (4h)
3. Write comprehensive tests (2h)

**Deliverables**:
- ✅ 6 MCP tools for audit access
- ✅ Full JSON report generation

---

### Phase 9: Testing & Documentation (Week 9, 10h)

**Tasks**:
1. Write unit tests for all modules (4h)
2. Write integration tests (3h)
3. Update specs documentation (3h)

**Deliverables**:
- ✅ 90%+ test coverage for audit system
- ✅ Complete specification in this document

---

**Total Timeline**: 9 weeks (142 hours)

---

## Testing Strategy

### Unit Tests

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_slow_query_detection() {
        let detector = SlowQueryDetector::new(100);

        detector.record_query("test", Duration::from_millis(150), QueryContext::default());

        let slow_queries = detector.find_slow_queries(Duration::from_secs(3600));
        assert_eq!(slow_queries.len(), 1);
        assert_eq!(slow_queries[0].execution_time_ms, 150);
    }

    #[test]
    fn test_memory_leak_detection() {
        let mut detector = MemoryLeakDetector::new();

        // Simulate monotonic growth
        for i in 0..20 {
            let snapshot = MemorySnapshot {
                timestamp: chrono::Utc::now(),
                rss_bytes: 1000000000 + (i * 50000000), // +50MB per snapshot
                heap_bytes: 0,
                stack_bytes: 0,
                mmap_bytes: 0,
            };
            detector.snapshots.push(snapshot);
        }

        let leak = detector.detect_memory_growth();
        assert!(leak.is_some());
        assert!(leak.unwrap().growth_rate_mb_per_hour > 10.0);
    }

    #[test]
    fn test_adaptive_thresholds() {
        let mut thresholds = AdaptiveThresholds::default();

        let baseline = Metrics { p95_latency_ms: 100.0, ..Default::default() };
        let improved = Metrics { p95_latency_ms: 80.0, ..Default::default() };

        thresholds.adjust_based_on_performance(&improved, &baseline);

        // Threshold should tighten by 5%
        assert_eq!(thresholds.slow_query_threshold_ms, 95);
    }
}
```

### Integration Tests

```rust
#[tokio::test]
async fn test_full_audit_cycle() {
    let audit_system = AuditSystem::new().await;

    // Run full audit
    let report = audit_system.run_audit(AuditScope::Full).await.unwrap();

    // Verify report structure
    assert!(report.findings.performance.is_some());
    assert!(report.findings.quality.is_some());
    assert!(report.findings.usage.is_some());

    // Verify tasks created
    let tasks = audit_system.get_created_tasks(&report.audit_id).await.unwrap();
    assert!(tasks.len() > 0);

    // Verify tasks linked to specs
    for task in tasks {
        assert!(task.spec_ref.is_some());
    }
}
```

---

## Success Metrics

### Functional Metrics

- ✅ Audit runs successfully every week without failures
- ✅ All 6 MCP tools functional
- ✅ Tasks auto-created with 100% success rate
- ✅ Reports generated in <5 seconds

### Performance Metrics

- ✅ Metrics collection overhead: <1% CPU
- ✅ Hourly profiling overhead: <5 seconds
- ✅ Weekly audit completes in <10 minutes

### Quality Metrics

- ✅ 90%+ test coverage for audit system
- ✅ Zero false positives in memory leak detection
- ✅ Regression detection accuracy: >95%

### Impact Metrics (after 3 months)

- ✅ Proactive issue detection: 80%+ of issues detected before user reports
- ✅ Performance improvement: Continuous 5-10% quarterly gains
- ✅ Test coverage: Maintained at >95%
- ✅ Tech debt reduction: 20%+ reduction in complexity metrics

---

## Conclusion

The **Meridian Self-Audit System** represents a paradigm shift from reactive debugging to **proactive self-optimization**. By continuously analyzing performance, quality, usage, and competitive positioning, Meridian will:

1. **Detect bottlenecks before users notice** (Netflix-style continuous validation)
2. **Automatically generate fixes** (SapFix-inspired issue creation)
3. **Evolve parameters without manual tuning** (AutoML-style optimization)
4. **Maintain zero-drift quality** (AWS-style target tracking)

**Expected ROI**:
- **Development time**: 142 hours (9 weeks)
- **Ongoing maintenance**: ~2 hours/week (reviewing audit reports)
- **Benefit**: Eliminates ~10 hours/week of manual performance debugging + ensures 24/7 health monitoring

**Next Steps**:
1. Approve this specification
2. Create tasks in progress system (9 phases × avg 4 tasks = 36 tasks)
3. Begin Phase 1: Infrastructure & Metrics Collection

---

**Specification Complete** ✅
