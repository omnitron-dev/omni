use anyhow::Result;
use chrono::{DateTime, Utc};
use serde_json::Value;
use std::path::PathBuf;

fn main() -> Result<()> {
    // Get metrics DB path - it's under index/metrics, not just metrics
    let home = dirs::home_dir().expect("Failed to get home directory");
    let metrics_path = home.join(".meridian/db/current/index/metrics");

    println!("Reading metrics from: {:?}\n", metrics_path);

    if !metrics_path.exists() {
        println!("❌ Metrics database does not exist!");
        println!("This means no metrics have been collected yet.");
        return Ok(());
    }

    // Open RocksDB for read-only
    let mut opts = rocksdb::Options::default();
    opts.create_if_missing(false);

    let db = rocksdb::DB::open_for_read_only(&opts, &metrics_path, false)?;

    println!("=== MCP Tool Usage Metrics ===\n");

    // Read all snapshots
    let mut snapshots = Vec::new();
    let iter = db.iterator(rocksdb::IteratorMode::Start);

    for item in iter {
        let (key, value) = item?;
        let key_str = String::from_utf8_lossy(&key);

        if key_str.starts_with("snapshot:") {
            let json_str = String::from_utf8_lossy(&value);
            if let Ok(snapshot) = serde_json::from_str::<Value>(&json_str) {
                snapshots.push((key_str.to_string(), snapshot));
            }
        }
    }

    if snapshots.is_empty() {
        println!("❌ No snapshots found!");
        println!("Metrics collection may not be enabled or no tools have been called yet.");
        return Ok(());
    }

    println!("Found {} snapshots\n", snapshots.len());

    // Get the latest snapshot
    if let Some((timestamp, snapshot)) = snapshots.last() {
        println!("📊 Latest Snapshot: {}\n", timestamp);
        println!("{}\n", serde_json::to_string_pretty(&snapshot)?);

        // Analyze tool usage
        if let Some(tools) = snapshot.get("tools").and_then(|t| t.as_object()) {
            println!("\n=== Tool Usage Analysis ===\n");

            let mut tool_list: Vec<_> = tools.iter().collect();
            tool_list.sort_by(|a, b| {
                let a_calls = a.1.get("total_calls").and_then(|c| c.as_u64()).unwrap_or(0);
                let b_calls = b.1.get("total_calls").and_then(|c| c.as_u64()).unwrap_or(0);
                b_calls.cmp(&a_calls)
            });

            println!("📈 Most Used Tools:");
            for (name, metrics) in tool_list.iter().take(10) {
                let calls = metrics.get("total_calls").and_then(|c| c.as_u64()).unwrap_or(0);
                let success = metrics.get("success_count").and_then(|c| c.as_u64()).unwrap_or(0);
                let errors = metrics.get("error_count").and_then(|c| c.as_u64()).unwrap_or(0);
                let avg_latency = metrics.get("avg_latency_ms").and_then(|c| c.as_f64()).unwrap_or(0.0);

                println!(
                    "  {} - {} calls ({} success, {} errors, {:.2}ms avg)",
                    name, calls, success, errors, avg_latency
                );
            }

            println!("\n🚫 Never Used Tools:");
            let mut unused = Vec::new();
            for (name, metrics) in tools.iter() {
                let calls = metrics.get("total_calls").and_then(|c| c.as_u64()).unwrap_or(0);
                if calls == 0 {
                    unused.push(name.as_str());
                }
            }

            if unused.is_empty() {
                println!("  ✅ All tools have been used at least once!");
            } else {
                println!("  Total: {} tools never used", unused.len());
                for (i, name) in unused.iter().enumerate().take(20) {
                    println!("  {}) {}", i + 1, name);
                }
                if unused.len() > 20 {
                    println!("  ... and {} more", unused.len() - 20);
                }
            }

            println!("\n📊 Statistics:");
            println!("  Total tools tracked: {}", tools.len());
            println!("  Tools used: {}", tools.len() - unused.len());
            println!("  Tools never used: {}", unused.len());
            println!(
                "  Usage rate: {:.1}%",
                ((tools.len() - unused.len()) as f64 / tools.len() as f64) * 100.0
            );
        }

        // Token efficiency analysis
        if let Some(tokens) = snapshot.get("token_efficiency") {
            println!("\n=== Token Efficiency ===\n");
            println!("{}", serde_json::to_string_pretty(&tokens)?);
        }
    }

    Ok(())
}
