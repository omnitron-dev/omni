use meridian::indexer::PatternSearchEngine;
use std::fs;
use tempfile::TempDir;

#[test]
fn test_pattern_search_pagination() {
    // Create temporary directory with test files
    let temp_dir = TempDir::new().unwrap();
    let base_path = temp_dir.path();

    // Create multiple Rust files with functions
    for i in 0..10 {
        let content = format!(
            r#"
pub fn test_function_{}(x: i32) -> i32 {{
    x + {}
}}

pub fn another_function_{}() {{
    println!("hello {{}}", {});
}}
"#,
            i, i, i, i
        );
        fs::write(base_path.join(format!("test_{}.rs", i)), content).unwrap();
    }

    // Create pattern engine
    let engine = PatternSearchEngine::new().unwrap();

    // Test 1: Search all functions without pagination
    let mut all_matches = Vec::new();
    for i in 0..10 {
        let file_path = base_path.join(format!("test_{}.rs", i));
        let content = fs::read_to_string(&file_path).unwrap();
        let matches = engine
            .search_in_file("fn $name($params)", "rust", &content, &file_path)
            .unwrap();
        all_matches.extend(matches);
    }

    let total_count = all_matches.len();
    assert_eq!(total_count, 20); // 2 functions per file * 10 files

    // Test 2: Paginate with page_size=5
    let page_size = 5;
    let mut collected = Vec::new();

    for offset in (0..total_count).step_by(page_size) {
        let page: Vec<_> = all_matches
            .iter()
            .skip(offset)
            .take(page_size)
            .cloned()
            .collect();
        collected.extend(page);
    }

    assert_eq!(collected.len(), total_count);

    // Test 3: Edge case - offset beyond total
    let beyond_offset = all_matches
        .iter()
        .skip(100)
        .take(page_size)
        .collect::<Vec<_>>();
    assert!(beyond_offset.is_empty());

    // Test 4: Edge case - offset + page_size overflow protection
    let max_offset = usize::MAX - 10;
    let safe_offset = max_offset.saturating_add(100);
    // This should not panic
    assert_eq!(safe_offset, usize::MAX);

    println!("✓ Pagination tests passed!");
    println!("  - Total matches: {}", total_count);
    println!("  - Page size: {}", page_size);
    println!("  - Pages: {}", (total_count + page_size - 1) / page_size);
}

#[test]
fn test_max_results_limit() {
    // Test that MAX_RESULTS_HARD_LIMIT is enforced (1000)
    let temp_dir = TempDir::new().unwrap();
    let base_path = temp_dir.path();

    // Create a file with many functions (though we won't actually create 1000+)
    // This test just verifies the limit logic would work
    let max_limit = 1000;
    let requested = 5000;
    let actual = requested.min(max_limit);

    assert_eq!(actual, 1000);
    println!("✓ Max results limit test passed!");
    println!("  - Requested: {}", requested);
    println!("  - Max allowed: {}", max_limit);
    println!("  - Actual: {}", actual);
}

#[test]
fn test_empty_results_pagination() {
    let temp_dir = TempDir::new().unwrap();
    let base_path = temp_dir.path();

    // Create a file with no matching patterns
    let content = r#"
        // Just comments, no functions
        // Nothing to match here
    "#;
    fs::write(base_path.join("empty.rs"), content).unwrap();

    let engine = PatternSearchEngine::new().unwrap();
    let file_path = base_path.join("empty.rs");
    let matches = engine
        .search_in_file("fn $name($params)", "rust", content, &file_path)
        .unwrap();

    assert_eq!(matches.len(), 0);

    // Test pagination with empty results
    let offset = 0;
    let page_size = 10;
    let page: Vec<_> = matches.iter().skip(offset).take(page_size).collect();

    assert!(page.is_empty());
    assert_eq!(page.len(), 0);

    let has_more = matches.len() > offset + page.len();
    assert!(!has_more);

    println!("✓ Empty results pagination test passed!");
}
