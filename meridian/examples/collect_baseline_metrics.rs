/// Collect baseline metrics for self-improvement tracking
///
/// This example:
/// 1. Connects to SurrealDB
/// 2. Collects current metrics using SelfImprovementCollector
/// 3. Stores the baseline in the database
/// 4. Prints the baseline metrics in human-readable format

use anyhow::Result;
use meridian::metrics::SelfImprovementCollector;
use meridian::storage::SurrealDBStorage;
use std::path::PathBuf;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize tracing
    tracing_subscriber::fmt::init();

    println!("=== Meridian Self-Improvement Baseline Metrics Collector ===\n");

    // Initialize database
    let db_path = std::env::var("MERIDIAN_DB_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            dirs::data_local_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("meridian")
                .join("db")
        });

    println!("Connecting to database: {}", db_path.display());
    let storage = SurrealDBStorage::new(&db_path).await?;
    let db = storage.db();
    println!("✓ Database connected\n");

    // Create metrics collector
    let collector = SelfImprovementCollector::new(db.clone());

    // Collect current metrics
    println!("Collecting current metrics...");
    let metrics = collector.collect().await?;
    println!("✓ Metrics collected\n");

    // Store baseline
    println!("Storing baseline metrics to database...");
    collector.store(&metrics).await?;
    println!("✓ Baseline stored\n");

    // Print baseline metrics
    println!("╔════════════════════════════════════════════════════════════╗");
    println!("║          BASELINE METRICS (2025-10-19)                     ║");
    println!("╠════════════════════════════════════════════════════════════╣");
    println!("║                                                            ║");
    println!("║  Overall Health Score:    {:.2} ({})              ║",
        metrics.health_score,
        metrics.health_rating()
    );
    println!("║                                                            ║");
    println!("║  Code Quality Score:      {:.2}                          ║", metrics.code_quality_score);
    println!("║  Test Coverage:           {:.1}%                         ║", metrics.test_coverage_percent);
    println!("║  Technical Debt Score:    {:.2}                          ║", metrics.technical_debt_score);
    println!("║                                                            ║");
    println!("║  Avg Complexity:          {:.2}                          ║", metrics.avg_cyclomatic_complexity);
    println!("║  High Complexity Symbols: {}                             ║", metrics.high_complexity_symbols_count);
    println!("║  Untested Symbols:        {}                             ║", metrics.untested_symbols_count);
    println!("║  Undocumented Symbols:    {}                             ║", metrics.undocumented_symbols_count);
    println!("║  Circular Dependencies:   {}                             ║", metrics.circular_dependencies_count);
    println!("║                                                            ║");
    println!("║  Improvements This Week:  {}                             ║", metrics.improvements_per_week);
    println!("║  Avg Improvement Time:    {:.1}h                         ║", metrics.avg_improvement_time_hours);
    println!("║                                                            ║");
    println!("║  Trend:                   {:?}                        ║", metrics.trend_direction);
    println!("║                                                            ║");
    println!("╠════════════════════════════════════════════════════════════╣");
    println!("║  Language Breakdown:                                       ║");
    println!("╠════════════════════════════════════════════════════════════╣");

    for (lang, lang_metrics) in &metrics.language_breakdown {
        println!("║                                                            ║");
        println!("║  {:<20}                                      ║", lang);
        println!("║    Symbols:        {}                                    ║", lang_metrics.symbol_count);
        println!("║    Avg Complexity: {:.2}                                ║", lang_metrics.avg_complexity);
        println!("║    Test Coverage:  {:.1}%                               ║", lang_metrics.test_coverage_percent);
        println!("║    Health Score:   {:.2}                                ║", lang_metrics.health_score);
    }

    println!("║                                                            ║");
    println!("╚════════════════════════════════════════════════════════════╝");

    // Print JSON format for programmatic access
    println!("\n=== JSON Format ===\n");
    println!("{}", serde_json::to_string_pretty(&metrics)?);

    println!("\n✓ Baseline metrics collection complete!");
    println!("  Timestamp: {}", metrics.timestamp);

    Ok(())
}
