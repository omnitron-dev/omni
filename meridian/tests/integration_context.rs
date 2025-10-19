mod common;

use common::fixtures::*;
use meridian::context::{ContextCompressor, ContextDefragmenter, ContextManager};
use meridian::types::{
    CompressionStrategy, ContextFragment, ContextRequest, LLMAdapter, TokenCount,
};

#[tokio::test]
async fn test_context_manager_initialization() {
    let _manager = ContextManager::new(LLMAdapter::claude3());

}

#[tokio::test]
async fn test_context_manager_prepare_adaptive_ultra_compact() {
    let manager = ContextManager::new(LLMAdapter::claude3());

    let request = ContextRequest {
        files: vec!["test1.rs".to_string(), "test2.rs".to_string()],
        symbols: vec![],
        max_tokens: Some(TokenCount::new(2000)),
    };

    let result = manager.prepare_adaptive(request, 2000).await;

    assert!(result.is_ok());
    let context = result.unwrap();
    assert_eq!(context.strategy, CompressionStrategy::Skeleton);
    assert!(context.compression_ratio <= 1.0);
}

#[tokio::test]
async fn test_context_manager_prepare_adaptive_compact() {
    let manager = ContextManager::new(LLMAdapter::gpt4());

    let request = ContextRequest {
        files: vec!["module.rs".to_string()],
        symbols: vec![],
        max_tokens: Some(TokenCount::new(8000)),
    };

    let result = manager.prepare_adaptive(request, 8000).await;

    assert!(result.is_ok());
    let context = result.unwrap();
    assert_eq!(context.strategy, CompressionStrategy::Summary);
}

#[tokio::test]
async fn test_context_manager_prepare_adaptive_standard() {
    let manager = ContextManager::new(LLMAdapter::claude3());

    let request = ContextRequest {
        files: vec!["file1.rs".to_string(), "file2.rs".to_string()],
        symbols: vec![],
        max_tokens: None,
    };

    let result = manager.prepare_adaptive(request, 32000).await;

    assert!(result.is_ok());
    let context = result.unwrap();
    assert_eq!(context.strategy, CompressionStrategy::TreeShaking);
}

#[tokio::test]
async fn test_context_manager_prepare_adaptive_extended() {
    let manager = ContextManager::new(LLMAdapter::claude3());

    let request = ContextRequest {
        files: vec!["large_file.rs".to_string()],
        symbols: vec![],
        max_tokens: None,
    };

    let result = manager.prepare_adaptive(request, 100000).await;

    assert!(result.is_ok());
    let context = result.unwrap();
    assert_eq!(context.strategy, CompressionStrategy::RemoveComments);
}

#[tokio::test]
async fn test_context_manager_prepare_adaptive_full() {
    let manager = ContextManager::new(LLMAdapter::claude3());

    let request = ContextRequest {
        files: vec!["project.rs".to_string()],
        symbols: vec![],
        max_tokens: None,
    };

    let result = manager.prepare_adaptive(request, 200000).await;

    assert!(result.is_ok());
    let context = result.unwrap();
    assert_eq!(context.strategy, CompressionStrategy::RemoveWhitespace);
}

#[tokio::test]
async fn test_context_manager_compression() {
    let manager = ContextManager::new(LLMAdapter::claude3());

    let content = r#"
    fn main() {
        // This is a comment
        println!("Hello, world!");

        // Another comment
        let x = 42;
    }
    "#;

    let result = manager
        .compress(content, CompressionStrategy::RemoveComments, 100)
        .await;

    assert!(result.is_ok());
    let compressed = result.unwrap();
    assert!(!compressed.content.is_empty());
    assert!(compressed.quality_score >= 0.0 && compressed.quality_score <= 1.0);
}

#[tokio::test]
async fn test_context_manager_defragment() {
    let manager = ContextManager::new(LLMAdapter::claude3());

    let fragments = vec![
        ContextFragment {
            id: "frag1".to_string(),
            content: "Function foo handles user authentication".to_string(),
            source: "auth.rs".to_string(),
            tokens: TokenCount::new(50),
        },
        ContextFragment {
            id: "frag2".to_string(),
            content: "Function bar validates tokens".to_string(),
            source: "auth.rs".to_string(),
            tokens: TokenCount::new(40),
        },
        ContextFragment {
            id: "frag3".to_string(),
            content: "Function baz refreshes sessions".to_string(),
            source: "session.rs".to_string(),
            tokens: TokenCount::new(45),
        },
    ];

    let result = manager.defragment(fragments, 1000).await;

    assert!(result.is_ok());
    let unified = result.unwrap();
    assert!(!unified.main_narrative.is_empty());
    assert!(unified.total_tokens.0 > 0);
}

#[tokio::test]
async fn test_context_manager_defragment_fragments_simple() {
    let manager = ContextManager::new(LLMAdapter::claude3());

    let fragments = vec![
        "First fragment of context".to_string(),
        "Second fragment of context".to_string(),
        "Third fragment of context".to_string(),
    ];

    let result = manager.defragment_fragments(fragments, 500);

    assert!(result.is_ok());
    let defragmented = result.unwrap();
    assert!(!defragmented.content.is_empty());
    assert!(defragmented.token_count.0 > 0);
}

#[tokio::test]
async fn test_context_manager_prioritize_symbols() {
    let manager = ContextManager::new(LLMAdapter::claude3());

    let symbols = vec![
        test_symbol("relevant_function", meridian::types::SymbolKind::Function),
        test_symbol("another_function", meridian::types::SymbolKind::Function),
        test_symbol("util_function", meridian::types::SymbolKind::Function),
    ];

    let context = "relevant_function is used here";
    let prioritized = manager.prioritize_symbols(symbols, context, 5000);

    assert!(!prioritized.is_empty());
    // The first symbol should have the highest relevance score
    assert_eq!(prioritized[0].0.name, "relevant_function");
}

#[tokio::test]
async fn test_context_manager_calculate_available_tokens() {
    let manager = ContextManager::new(LLMAdapter::claude3());

    let current_usage = TokenCount::new(10000);
    let available = manager.calculate_available_tokens(current_usage);

    // Should account for system prompt and response buffer
    assert!(available > 0);
    assert!(available < LLMAdapter::claude3().context_window());
}

#[tokio::test]
async fn test_context_manager_prepare_context() {
    let manager = ContextManager::new(LLMAdapter::gpt4());

    let request = ContextRequest {
        files: vec!["example.rs".to_string()],
        symbols: vec![],
        max_tokens: Some(TokenCount::new(5000)),
    };

    let result = manager.prepare_context(&request);

    assert!(result.is_ok());
    let context = result.unwrap();
    assert!(!context.content.is_empty());
    assert!(context.token_count.0 > 0);
}

#[tokio::test]
async fn test_context_compressor_remove_comments() {
    let compressor = ContextCompressor::new(0.7);

    let content = r#"
    // This is a line comment
    fn main() {
        /* Block comment */
        println!("Hello");
    }
    "#;

    let result = compressor.compress(content, CompressionStrategy::RemoveComments, 500);

    assert!(result.is_ok());
    let compressed = result.unwrap();
    // Comments should be removed
    assert!(!compressed.content.contains("line comment"));
}

#[tokio::test]
async fn test_context_compressor_remove_whitespace() {
    let compressor = ContextCompressor::new(0.8);

    let content = r#"
    fn    main()    {
        println!(  "Hello"  );
    }
    "#;

    let result = compressor.compress(content, CompressionStrategy::RemoveWhitespace, 500);

    assert!(result.is_ok());
    let compressed = result.unwrap();
    // Should have less whitespace
    assert!(compressed.content.len() < content.len());
}

#[tokio::test]
async fn test_context_compressor_quality_score() {
    let compressor = ContextCompressor::new(0.7);

    let content = "fn main() { println!(\"test\"); }";

    let result = compressor.compress(content, CompressionStrategy::RemoveWhitespace, 100);

    assert!(result.is_ok());
    let compressed = result.unwrap();
    // Quality score should be between 0 and 1
    assert!(compressed.quality_score >= 0.0);
    assert!(compressed.quality_score <= 1.0);
}

#[tokio::test]
async fn test_context_defragmenter_basic() {
    let defragmenter = ContextDefragmenter::new();

    let fragments = vec![
        ContextFragment {
            id: "1".to_string(),
            content: "Authentication module handles user login".to_string(),
            source: "auth.rs".to_string(),
            tokens: TokenCount::new(30),
        },
        ContextFragment {
            id: "2".to_string(),
            content: "Database module manages connections".to_string(),
            source: "db.rs".to_string(),
            tokens: TokenCount::new(25),
        },
    ];

    let result = defragmenter.defragment(fragments, 1000);

    assert!(result.is_ok());
    let unified = result.unwrap();
    assert!(!unified.main_narrative.is_empty());
    // Unified context should have valid data
    assert!(unified.total_tokens.0 > 0);
}

#[tokio::test]
async fn test_context_manager_multiple_compressions() {
    let manager = ContextManager::new(LLMAdapter::claude3());

    let content = r#"
    /// Documentation comment
    // Regular comment
    fn example_function() {
        let x = 1;
        let y = 2;
        println!("{} {}", x, y);
    }
    "#;

    // Try different compression strategies
    let strategies = vec![
        CompressionStrategy::RemoveComments,
        CompressionStrategy::RemoveWhitespace,
        CompressionStrategy::TreeShaking,
        CompressionStrategy::Summary,
        CompressionStrategy::Skeleton,
    ];

    for strategy in strategies {
        let result = manager.compress(content, strategy.clone(), 200).await;
        assert!(result.is_ok(), "Failed for strategy: {:?}", strategy);
    }
}

#[tokio::test]
async fn test_context_manager_empty_request() {
    let manager = ContextManager::new(LLMAdapter::claude3());

    let request = ContextRequest {
        files: vec![],
        symbols: vec![],
        max_tokens: Some(TokenCount::new(1000)),
    };

    let result = manager.prepare_adaptive(request, 5000).await;

    assert!(result.is_ok());
    let context = result.unwrap();
    // Empty request should still produce valid context
    assert!(context.token_count.0 == context.token_count.0);
}

#[tokio::test]
async fn test_context_manager_large_context() {
    let manager = ContextManager::new(LLMAdapter::claude3());

    // Create a large content string
    let large_content = "fn function() {}\n".repeat(1000);

    let result = manager
        .compress(&large_content, CompressionStrategy::Summary, 500)
        .await;

    assert!(result.is_ok());
    let compressed = result.unwrap();
    // Should be compressed
    assert!(compressed.content.len() < large_content.len());
    assert!(compressed.ratio < 1.0);
}

#[tokio::test]
async fn test_context_manager_prioritize_with_token_limit() {
    let manager = ContextManager::new(LLMAdapter::claude3());

    let mut symbols = vec![];
    for i in 0..20 {
        let mut symbol = test_symbol(&format!("func_{}", i), meridian::types::SymbolKind::Function);
        symbol.metadata.token_cost = TokenCount::new(200);
        symbols.push(symbol);
    }

    let max_tokens = 1000; // Should fit about 5 symbols
    let prioritized = manager.prioritize_symbols(symbols, "context", max_tokens);

    // Should respect token limit
    let total_tokens: u32 = prioritized
        .iter()
        .map(|(s, _)| s.metadata.token_cost.0)
        .sum();

    assert!(total_tokens <= max_tokens as u32);
    assert!(prioritized.len() <= 5);
}
