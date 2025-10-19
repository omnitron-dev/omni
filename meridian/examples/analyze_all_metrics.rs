use anyhow::Result;
use serde_json::Value;
use std::collections::HashMap;

fn main() -> Result<()> {
    let home = dirs::home_dir().expect("Failed to get home directory");
    let metrics_path = home.join(".meridian/db/current/index/metrics");

    println!("Analyzing ALL metrics snapshots from: {:?}\n", metrics_path);

    if !metrics_path.exists() {
        println!("❌ Metrics database does not exist!");
        return Ok(());
    }

    let mut opts = rocksdb::Options::default();
    opts.create_if_missing(false);

    let db = rocksdb::DB::open_for_read_only(&opts, &metrics_path, false)?;

    // Collect ALL snapshots
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

    println!("Found {} total snapshots\n", snapshots.len());

    // Aggregate tool metrics across ALL snapshots
    let mut tool_call_totals: HashMap<String, u64> = HashMap::new();
    let mut tool_success_totals: HashMap<String, u64> = HashMap::new();
    let mut tool_error_totals: HashMap<String, u64> = HashMap::new();
    let mut snapshots_with_data = 0;

    for (_timestamp, snapshot) in &snapshots {
        if let Some(tools) = snapshot.get("tools").and_then(|t| t.as_object()) {
            if !tools.is_empty() {
                snapshots_with_data += 1;

                for (tool_name, metrics) in tools {
                    let calls = metrics.get("total_calls").and_then(|c| c.as_u64()).unwrap_or(0);
                    let success = metrics.get("success_count").and_then(|c| c.as_u64()).unwrap_or(0);
                    let errors = metrics.get("error_count").and_then(|c| c.as_u64()).unwrap_or(0);

                    *tool_call_totals.entry(tool_name.clone()).or_insert(0) += calls;
                    *tool_success_totals.entry(tool_name.clone()).or_insert(0) += success;
                    *tool_error_totals.entry(tool_name.clone()).or_insert(0) += errors;
                }
            }
        }
    }

    println!("Snapshots with tool data: {}\n", snapshots_with_data);

    if tool_call_totals.is_empty() {
        println!("❌ No tool usage data found across all snapshots!");
        println!("This means either:");
        println!("  1. No tools have been called yet");
        println!("  2. Metrics collection is not working properly");
        println!("  3. Snapshots are being created before tool calls");
        return Ok(());
    }

    // Sort tools by call count
    let mut tools: Vec<_> = tool_call_totals.iter().collect();
    tools.sort_by(|a, b| b.1.cmp(a.1));

    println!("=== Aggregated Tool Usage (All Time) ===\n");
    println!("📊 Tool Statistics:");
    println!("  Total tools with calls: {}", tools.len());
    println!("  Total calls across all tools: {}\n", tools.iter().map(|(_, c)| *c).sum::<u64>());

    println!("📈 Top 20 Most Used Tools:");
    for (i, (tool_name, calls)) in tools.iter().take(20).enumerate() {
        let success = tool_success_totals.get(*tool_name).unwrap_or(&0);
        let errors = tool_error_totals.get(*tool_name).unwrap_or(&0);
        let success_rate = if **calls > 0 {
            (*success as f64 / **calls as f64) * 100.0
        } else {
            0.0
        };

        println!(
            "  {:2}. {:30} - {:6} calls ({:5} ✓, {:4} ✗, {:5.1}% success)",
            i + 1, tool_name, calls, success, errors, success_rate
        );
    }

    // Find tools with errors
    println!("\n⚠️  Tools with Errors:");
    let mut error_tools: Vec<_> = tool_error_totals.iter()
        .filter(|(_, &count)| count > 0)
        .collect();
    error_tools.sort_by(|a, b| b.1.cmp(a.1));

    if error_tools.is_empty() {
        println!("  ✅ No errors recorded!");
    } else {
        for (i, (tool_name, errors)) in error_tools.iter().take(10).enumerate() {
            let total = tool_call_totals.get(*tool_name).unwrap_or(&0);
            let error_rate = if *total > 0 {
                (**errors as f64 / *total as f64) * 100.0
            } else {
                0.0
            };
            println!(
                "  {:2}. {:30} - {:4} errors ({:5.1}% error rate)",
                i + 1, tool_name, errors, error_rate
            );
        }
    }

    Ok(())
}
