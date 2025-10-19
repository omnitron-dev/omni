/// Example demonstrating graph-based code analysis using SurrealDB
///
/// This example shows:
/// 1. Indexing code symbols with relationships
/// 2. Querying dependencies (transitive)
/// 3. Finding similar code patterns
/// 4. Analyzing impact of changes
/// 5. Semantic search using embeddings

use anyhow::Result;
use meridian::embeddings::{CodeEmbedder, LocalCodeEmbedder};
use meridian::graph::CodeGraphAnalyzer;
use meridian::storage::SurrealDBStorage;
use meridian::types::{CodeSymbol, Location, SymbolId, SymbolKind, SymbolMetadata, Hash};
use std::sync::Arc;
use tempfile::TempDir;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    tracing_subscriber::fmt::init();

    println!("=== Graph-Based Code Analysis Example ===\n");

    // Create temporary directory for SurrealDB
    let temp_dir = TempDir::new()?;
    println!("📁 Using temp directory: {:?}", temp_dir.path());

    // Initialize SurrealDB storage
    println!("🔧 Initializing SurrealDB storage...");
    let storage = SurrealDBStorage::new(temp_dir.path()).await?;
    let db = storage.db();

    // Create embedder for semantic search
    println!("🤖 Initializing code embedder...");
    let embedder = LocalCodeEmbedder::new()?;
    let embedder_arc: Arc<dyn CodeEmbedder> = Arc::new(embedder);

    // Create graph analyzer
    let analyzer = CodeGraphAnalyzer::new(db);

    println!("\n--- Step 1: Index Sample Code ---\n");

    // Create sample code symbols
    let payment_processor = CodeSymbol {
        id: SymbolId::new("payment_processor"),
        name: "PaymentProcessor".to_string(),
        kind: SymbolKind::Class,
        signature: "class PaymentProcessor".to_string(),
        body_hash: Hash::from_string("hash1"),
        location: Location::new(
            "src/payment.rs".to_string(),
            10,
            50,
            0,
            0,
        ),
        references: vec![],
        dependencies: vec![
            SymbolId::new("validate_card"),
            SymbolId::new("charge_account"),
        ],
        metadata: SymbolMetadata {
            complexity: 15,
            ..Default::default()
        },
        embedding: Some(embedder_arc.embed_code("payment processing and charging").await?),
    };

    let validate_card = CodeSymbol {
        id: SymbolId::new("validate_card"),
        name: "validate_card".to_string(),
        kind: SymbolKind::Function,
        signature: "fn validate_card(card: &Card) -> Result<bool>".to_string(),
        body_hash: Hash::from_string("hash2"),
        location: Location::new(
            "src/payment.rs".to_string(),
            60,
            80,
            0,
            0,
        ),
        references: vec![],
        dependencies: vec![SymbolId::new("luhn_check")],
        metadata: SymbolMetadata {
            complexity: 8,
            ..Default::default()
        },
        embedding: Some(embedder_arc.embed_code("validate credit card number").await?),
    };

    let charge_account = CodeSymbol {
        id: SymbolId::new("charge_account"),
        name: "charge_account".to_string(),
        kind: SymbolKind::Function,
        signature: "fn charge_account(account: &Account, amount: Money) -> Result<()>".to_string(),
        body_hash: Hash::from_string("hash3"),
        location: Location::new(
            "src/payment.rs".to_string(),
            90,
            120,
            0,
            0,
        ),
        references: vec![],
        dependencies: vec![
            SymbolId::new("check_balance"),
            SymbolId::new("create_transaction"),
        ],
        metadata: SymbolMetadata {
            complexity: 12,
            ..Default::default()
        },
        embedding: Some(embedder_arc.embed_code("charge money from account").await?),
    };

    let luhn_check = CodeSymbol {
        id: SymbolId::new("luhn_check"),
        name: "luhn_check".to_string(),
        kind: SymbolKind::Function,
        signature: "fn luhn_check(number: &str) -> bool".to_string(),
        body_hash: Hash::from_string("hash4"),
        location: Location::new(
            "src/utils.rs".to_string(),
            5,
            25,
            0,
            0,
        ),
        references: vec![],
        dependencies: vec![],
        metadata: SymbolMetadata {
            complexity: 5,
            ..Default::default()
        },
        embedding: Some(embedder_arc.embed_code("luhn algorithm for card validation").await?),
    };

    // Index all symbols
    println!("📝 Indexing symbols...");
    analyzer.index_symbol(payment_processor.clone()).await?;
    analyzer.index_symbol(validate_card.clone()).await?;
    analyzer.index_symbol(charge_account.clone()).await?;
    analyzer.index_symbol(luhn_check.clone()).await?;
    println!("✅ Indexed 4 symbols");

    println!("\n--- Step 2: Find Dependencies ---\n");

    let deps = analyzer.find_dependencies("payment_processor", 3).await?;
    println!("🔍 Dependencies of PaymentProcessor:");
    println!("   Total nodes: {}", deps.count());
    for node in &deps.nodes {
        println!(
            "   - {} ({}) in {} [depth: {}]",
            node.name, node.symbol_type, node.file_path, node.depth
        );
    }
    println!("   Edges: {}", deps.edges.len());

    println!("\n--- Step 3: Find Reverse Dependencies ---\n");

    let dependents = analyzer.find_dependents("validate_card").await?;
    println!("🔍 Symbols that depend on validate_card:");
    for symbol in &dependents {
        println!("   - {} ({}) in {}", symbol.name, symbol.kind.as_str(), symbol.location.file);
    }

    println!("\n--- Step 4: Semantic Search ---\n");

    let search_results = analyzer
        .semantic_search("credit card validation", 3)
        .await?;
    println!("🔍 Semantic search for 'credit card validation':");
    for result in &search_results {
        println!(
            "   - {} ({}) - similarity: {:.3}",
            result.symbol.name,
            result.symbol.kind.as_str(),
            result.similarity
        );
    }

    println!("\n--- Step 5: Find Similar Patterns ---\n");

    let patterns = analyzer.find_similar_patterns("charge_account").await?;
    println!("🔍 Patterns similar to charge_account:");
    for pattern in patterns.iter().take(3) {
        println!(
            "   - {} ({}) - in/out: {}/{}",
            pattern.symbol_name, pattern.symbol_type, pattern.in_degree, pattern.out_degree
        );
    }

    println!("\n--- Step 6: Impact Analysis ---\n");

    let impact = analyzer
        .impact_analysis(vec!["validate_card".to_string()])
        .await?;
    println!("🔍 Impact of changing validate_card:");
    println!("   Total affected symbols: {}", impact.total_affected);
    println!("   Affected files: {}", impact.affected_files.len());
    for file in &impact.affected_files {
        println!("   - {}", file);
    }
    if !impact.affected_symbols.is_empty() {
        println!("   Affected symbols:");
        for symbol in impact.affected_symbols.iter().take(5) {
            println!("   - {} ({})", symbol.name, symbol.kind.as_str());
        }
    }

    println!("\n--- Step 7: Get Full Symbol Information ---\n");

    let symbol = analyzer.get_symbol("payment_processor").await?;
    if let Some(s) = symbol {
        println!("📦 Full symbol info for PaymentProcessor:");
        println!("   Name: {}", s.name);
        println!("   Kind: {:?}", s.kind);
        println!("   Location: {}:{}:{}", s.location.file, s.location.line_start, s.location.line_end);
        println!("   Dependencies: {}", s.dependencies.len());
        println!("   Complexity: {}", s.metadata.complexity);
        if let Some(embedding) = &s.embedding {
            println!("   Embedding: {} dimensions", embedding.len());
        }
    }

    println!("\n=== Example Complete ===\n");
    println!("💡 Key Features Demonstrated:");
    println!("   ✓ Symbol indexing with relationships");
    println!("   ✓ Transitive dependency traversal");
    println!("   ✓ Reverse dependency lookup");
    println!("   ✓ Semantic similarity search");
    println!("   ✓ Graph pattern matching");
    println!("   ✓ Impact analysis for changes");

    println!("\n🚀 Next Steps:");
    println!("   - Index larger codebases");
    println!("   - Use MCP tools for interactive queries");
    println!("   - Integrate with CI/CD for change impact");
    println!("   - Build code understanding workflows");

    Ok(())
}
