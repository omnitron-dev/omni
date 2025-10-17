// Test embeddings module in isolation
use anyhow::Result;

#[path = "src/embeddings/mod.rs"]
mod embeddings;

fn main() -> Result<()> {
    println!("Testing embeddings module...");

    let engine = embeddings::EmbeddingEngine::new()?;
    println!("✓ Created embedding engine");

    let text = "fn test_function(x: i32) -> i32 { x + 1 }";
    let embedding = engine.generate_embedding(text)?;
    println!("✓ Generated embedding of size: {}", embedding.len());
    assert_eq!(embedding.len(), 384, "Expected 384-dimensional vector");

    // Test caching
    let embedding2 = engine.generate_embedding(text)?;
    assert_eq!(embedding, embedding2, "Cache should return identical embedding");
    println!("✓ Caching works");

    // Test similarity
    let text1 = "fn add(a: i32, b: i32) -> i32 { a + b }";
    let text2 = "fn sum(x: i32, y: i32) -> i32 { x + y }";
    let text3 = "struct User { name: String }";

    let emb1 = engine.generate_embedding(text1)?;
    let emb2 = engine.generate_embedding(text2)?;
    let emb3 = engine.generate_embedding(text3)?;

    let sim_12 = embeddings::EmbeddingEngine::cosine_similarity(&emb1, &emb2);
    let sim_13 = embeddings::EmbeddingEngine::cosine_similarity(&emb1, &emb3);

    println!("✓ Similarity between similar functions: {:.3}", sim_12);
    println!("✓ Similarity between different concepts: {:.3}", sim_13);
    assert!(sim_12 > sim_13, "Similar functions should have higher similarity");

    // Test batch generation
    let texts = vec![
        "fn test1() {}",
        "fn test2() {}",
        "fn test3() {}",
    ];
    let embeddings = engine.batch_generate(texts)?;
    println!("✓ Batch generated {} embeddings", embeddings.len());
    assert_eq!(embeddings.len(), 3);

    println!("\n✅ All embeddings tests passed!");
    Ok(())
}
