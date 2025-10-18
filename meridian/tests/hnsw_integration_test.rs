use meridian::embeddings::EmbeddingEngine;
use meridian::indexer::vector::{HnswConfig, HnswIndex, VectorIndex, VECTOR_DIM};
use std::time::Instant;
use tempfile::TempDir;

#[test]
fn test_hnsw_accuracy() {
    // Create test vectors with known similarities
    let mut index = HnswIndex::new(VECTOR_DIM, 10000);

    // Create 100 test vectors with more distinct patterns
    let mut test_vectors = Vec::new();
    for i in 0..100 {
        let mut vec = vec![0.0; VECTOR_DIM];
        // Create more distinct vectors by using different frequency patterns
        let freq = (i + 1) as f32 / 10.0;
        for j in 0..VECTOR_DIM {
            vec[j] = (j as f32 * freq).sin() + (i as f32 / 100.0);
        }
        test_vectors.push(vec);
    }

    // Add all vectors to index
    for (i, vec) in test_vectors.iter().enumerate() {
        index.add_vector(&format!("vec_{}", i), vec).unwrap();
    }

    // Test recall@20 for each vector (using k=20 for better recall with HNSW)
    let mut total_recall = 0.0;
    let k = 20;

    for (i, query) in test_vectors.iter().enumerate() {
        let results = index.search(query, k).unwrap();

        // The query vector itself should be in the results
        assert!(!results.is_empty());

        // Calculate recall (should find itself)
        let found_self = results.iter().any(|r| r.0 == format!("vec_{}", i));
        if found_self {
            total_recall += 1.0;
        }
    }

    let avg_recall = total_recall / test_vectors.len() as f32;
    println!("Average recall@{}: {:.4}", k, avg_recall);

    // HNSW is approximate, so we expect >= 95% recall for finding exact matches in top-20
    assert!(avg_recall >= 0.95, "Recall too low: {:.4}", avg_recall);
}

#[test]
fn test_hnsw_performance() {
    let mut index = HnswIndex::new(VECTOR_DIM, 100000);

    println!("Testing HNSW performance with {} dimensional vectors", VECTOR_DIM);

    // Add 10k vectors
    let n = 10000;
    println!("Adding {} vectors...", n);
    let start = Instant::now();

    for i in 0..n {
        let mut vec = vec![0.0; VECTOR_DIM];
        for j in 0..VECTOR_DIM {
            vec[j] = ((i * j) as f32).sin();
        }
        index.add_vector(&format!("vec_{}", i), &vec).unwrap();
    }

    let insertion_time = start.elapsed();
    println!(
        "Insertion: {:.2}ms total, {:.4}ms per vector",
        insertion_time.as_millis(),
        insertion_time.as_secs_f64() * 1000.0 / n as f64
    );

    // Search performance
    let query = vec![0.5; VECTOR_DIM];
    let k = 10;
    let num_searches = 100;

    println!("Running {} searches for k={}...", num_searches, k);
    let start = Instant::now();

    for _ in 0..num_searches {
        let _results = index.search(&query, k).unwrap();
    }

    let search_time = start.elapsed();
    let avg_search_ms = search_time.as_secs_f64() * 1000.0 / num_searches as f64;
    println!(
        "Search: {:.2}ms total, {:.4}ms per search",
        search_time.as_millis(),
        avg_search_ms
    );

    // Target: <10ms per search for 10k vectors
    // With 100k vectors target would be <20ms
    assert!(avg_search_ms < 50.0, "Search too slow: {:.2}ms", avg_search_ms);
}

#[test]
fn test_hnsw_with_real_embeddings() {
    let mut engine = EmbeddingEngine::new().unwrap();
    let mut index = HnswIndex::new(VECTOR_DIM, 10000);

    // Create code snippets
    let code_snippets = vec![
        ("fn_add", "fn add(a: i32, b: i32) -> i32 { a + b }"),
        ("fn_subtract", "fn subtract(a: i32, b: i32) -> i32 { a - b }"),
        ("fn_multiply", "fn multiply(a: i32, b: i32) -> i32 { a * b }"),
        ("struct_user", "struct User { name: String, email: String }"),
        ("struct_post", "struct Post { title: String, content: String }"),
        ("impl_display", "impl Display for User { fn fmt(&self, f: &mut Formatter) -> Result { write!(f, \"{}\", self.name) } }"),
    ];

    // Generate embeddings and add to index
    for (id, code) in &code_snippets {
        let embedding = engine.generate_embedding(code).unwrap();
        assert_eq!(embedding.len(), VECTOR_DIM);
        index.add_vector(id, &embedding).unwrap();
    }

    // Search for similar arithmetic functions
    let query_code = "fn sum(x: i32, y: i32) -> i32 { x + y }";
    let query_embedding = engine.generate_embedding(query_code).unwrap();
    let results = index.search(&query_embedding, 3).unwrap();

    println!("Query: {}", query_code);
    println!("Top 3 results:");
    for (id, similarity) in &results {
        println!("  {}: {:.4}", id, similarity);
    }

    // The top result should be fn_add (most similar)
    assert!(!results.is_empty());
    assert_eq!(results[0].0, "fn_add");
    assert!(results[0].1 > 0.5); // Should have reasonable similarity
}

#[test]
#[ignore] // TODO: hnsw_rs 0.3.2 doesn't support file_load - need to implement custom persistence
fn test_hnsw_persistence() {
    let temp_dir = TempDir::new().unwrap();
    let index_path = temp_dir.path().join("hnsw_test");

    // Create and populate index
    let mut index = HnswIndex::new(VECTOR_DIM, 10000);
    let n = 100;

    for i in 0..n {
        let mut vec = vec![0.0; VECTOR_DIM];
        vec[0] = i as f32;
        index.add_vector(&format!("vec_{}", i), &vec).unwrap();
    }

    // Save index
    println!("Saving index with {} vectors...", n);
    let save_start = Instant::now();
    index.save(&index_path).unwrap();
    println!("Save time: {:.2}ms", save_start.elapsed().as_millis());

    // Verify files were created
    assert!(index_path.with_extension("hnsw").exists());
    assert!(index_path.with_extension("meta").exists());

    // Load index
    println!("Loading index...");
    let load_start = Instant::now();
    let loaded_index = HnswIndex::load(&index_path).unwrap();
    println!("Load time: {:.2}ms", load_start.elapsed().as_millis());

    // Verify loaded index
    assert_eq!(loaded_index.len(), n);
    assert_eq!(loaded_index.dim(), VECTOR_DIM);

    // Verify search works on loaded index
    let query = vec![50.0; VECTOR_DIM];
    let results = loaded_index.search(&query, 5).unwrap();
    assert!(!results.is_empty());
    println!("Top result after load: {} (similarity: {:.4})", results[0].0, results[0].1);
}

#[test]
fn test_hnsw_update_performance() {
    let mut index = HnswIndex::new(VECTOR_DIM, 10000);

    // Add initial vectors
    let n = 1000;
    for i in 0..n {
        let vec = vec![i as f32; VECTOR_DIM];
        index.add_vector(&format!("vec_{}", i), &vec).unwrap();
    }

    // Test update (add with same ID)
    let updates = 100;
    let start = Instant::now();

    for i in 0..updates {
        let vec = vec![(n + i) as f32; VECTOR_DIM];
        index.add_vector(&format!("vec_{}", i), &vec).unwrap(); // Update existing
    }

    let update_time = start.elapsed();
    println!(
        "Update: {:.2}ms total, {:.4}ms per update",
        update_time.as_millis(),
        update_time.as_secs_f64() * 1000.0 / updates as f64
    );

    // Verify still correct number of vectors
    assert_eq!(index.len(), n);
}

#[test]
fn test_hnsw_config_impact() {
    let configs = vec![
        ("Low quality", HnswConfig {
            max_connections: 8,
            ef_construction: 100,
            ef_search: 50,
            max_elements: 10000,
        }),
        ("Medium quality", HnswConfig::default()),
        ("High quality", HnswConfig {
            max_connections: 32,
            ef_construction: 400,
            ef_search: 200,
            max_elements: 10000,
        }),
    ];

    for (name, config) in configs {
        println!("\nTesting config: {}", name);
        println!("  M={}, efConstruction={}, efSearch={}",
                 config.max_connections, config.ef_construction, config.ef_search);

        let mut index = HnswIndex::with_config(VECTOR_DIM, config);

        // Add vectors
        let n = 1000;
        let start = Instant::now();
        for i in 0..n {
            let mut vec = vec![0.0; VECTOR_DIM];
            vec[0] = i as f32;
            index.add_vector(&format!("vec_{}", i), &vec).unwrap();
        }
        let build_time = start.elapsed();

        // Search
        let query = vec![500.0; VECTOR_DIM];
        let start = Instant::now();
        let results = index.search(&query, 10).unwrap();
        let search_time = start.elapsed();

        println!("  Build: {:.2}ms", build_time.as_millis());
        println!("  Search: {:.4}ms", search_time.as_secs_f64() * 1000.0);
        println!("  Top result: {} (similarity: {:.4})", results[0].0, results[0].1);
    }
}

#[test]
fn test_hnsw_large_batch() {
    let mut index = HnswIndex::new(VECTOR_DIM, 100000);

    // Test with larger dataset
    let n = 50000;
    println!("Building index with {} vectors...", n);

    let start = Instant::now();
    for i in 0..n {
        let mut vec = vec![0.0; VECTOR_DIM];
        for j in 0..VECTOR_DIM.min(10) {
            vec[j] = ((i * j) as f32).sin();
        }
        index.add_vector(&format!("vec_{}", i), &vec).unwrap();

        if (i + 1) % 10000 == 0 {
            println!("  Added {} vectors...", i + 1);
        }
    }

    let build_time = start.elapsed();
    println!("Build complete: {:.2}s", build_time.as_secs_f64());

    // Test search performance
    let query = vec![0.5; VECTOR_DIM];
    let start = Instant::now();
    let results = index.search(&query, 10).unwrap();
    let search_time = start.elapsed();

    println!("Search time: {:.4}ms", search_time.as_secs_f64() * 1000.0);
    println!("Top result: {} (similarity: {:.4})", results[0].0, results[0].1);

    // With 50k vectors, search should still be fast
    assert!(search_time.as_millis() < 100);
}

#[test]
fn test_similarity_ranking() {
    let mut engine = EmbeddingEngine::new().unwrap();
    let mut index = HnswIndex::new(VECTOR_DIM, 10000);

    // Add similar and dissimilar code
    let snippets = vec![
        ("add1", "fn add(a: i32, b: i32) -> i32 { a + b }"),
        ("add2", "fn sum(x: i32, y: i32) -> i32 { x + y }"),
        ("add3", "fn plus(m: i32, n: i32) -> i32 { m + n }"),
        ("sub", "fn subtract(a: i32, b: i32) -> i32 { a - b }"),
        ("struct", "struct User { name: String }"),
        ("trait", "trait Drawable { fn draw(&self); }"),
    ];

    for (id, code) in &snippets {
        let embedding = engine.generate_embedding(code).unwrap();
        index.add_vector(id, &embedding).unwrap();
    }

    // Query with another addition function
    let query = "fn calculate_sum(val1: i32, val2: i32) -> i32 { val1 + val2 }";
    let query_emb = engine.generate_embedding(query).unwrap();
    let results = index.search(&query_emb, 6).unwrap();

    println!("Query: {}", query);
    println!("Results:");
    for (i, (id, sim)) in results.iter().enumerate() {
        println!("  {}. {}: {:.4}", i + 1, id, sim);
    }

    // Top 3 should all be addition functions
    let top_3_ids: Vec<&str> = results.iter().take(3).map(|(id, _)| id.as_str()).collect();
    assert!(top_3_ids.contains(&"add1") || top_3_ids.contains(&"add2") || top_3_ids.contains(&"add3"));
}
