use super::{Indexer, TreeSitterParser};
use crate::config::IndexConfig;
use crate::embeddings::EmbeddingEngine;
use crate::storage::{deserialize, serialize, Storage};
use crate::types::{
    CodeSymbol, DetailLevel, Query, QueryResult, Reference, ReferenceKind,
    SymbolDefinition, SymbolId, TokenCount,
};
use anyhow::{Context, Result};
use dashmap::DashMap;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// Dependency graph edge
#[derive(Debug, Clone)]
struct Dependency {
    from: SymbolId,
    to: SymbolId,
    kind: ReferenceKind,
}

/// Dependency graph
#[derive(Debug, Clone)]
pub struct DependencyGraph {
    pub nodes: Vec<SymbolId>,
    pub edges: Vec<(SymbolId, SymbolId, ReferenceKind)>,
}

pub struct CodeIndexer {
    storage: Arc<dyn Storage>,
    config: IndexConfig,
    parser: TreeSitterParser,
    // In-memory cache for fast lookups
    symbols: DashMap<SymbolId, CodeSymbol>,
    // Symbol name to ID mapping for fast lookup
    name_index: DashMap<String, Vec<SymbolId>>,
    // File to symbols mapping
    file_index: DashMap<PathBuf, Vec<SymbolId>>,
    // Dependency graph
    dependencies: DashMap<SymbolId, Vec<Dependency>>,
    // Source code cache for getting full definitions
    source_cache: DashMap<PathBuf, String>,
    // Embedding engine for semantic search
    embedding_engine: Arc<Mutex<EmbeddingEngine>>,
}

impl CodeIndexer {
    pub fn new(storage: Arc<dyn Storage>, config: IndexConfig) -> Result<Self> {
        let embedding_engine = Arc::new(Mutex::new(EmbeddingEngine::new()?));

        Ok(Self {
            storage,
            config,
            parser: TreeSitterParser::new()?,
            symbols: DashMap::new(),
            name_index: DashMap::new(),
            file_index: DashMap::new(),
            dependencies: DashMap::new(),
            source_cache: DashMap::new(),
            embedding_engine,
        })
    }

    /// Load existing index from storage
    pub async fn load(&mut self) -> Result<()> {
        let keys = self.storage.get_keys_with_prefix(b"symbol:").await?;

        for key in keys {
            if let Some(data) = self.storage.get(&key).await? {
                let symbol: CodeSymbol = deserialize(&data)?;
                let symbol_id = symbol.id.clone();
                let symbol_name = symbol.name.clone();
                let symbol_file = PathBuf::from(symbol.location.file.clone());

                // Add to symbol cache
                self.symbols.insert(symbol_id.clone(), symbol.clone());

                // Add to name index
                self.name_index
                    .entry(symbol_name)
                    .or_default()
                    .push(symbol_id.clone());

                // Add to file index
                self.file_index
                    .entry(symbol_file)
                    .or_default()
                    .push(symbol_id.clone());

                // Build dependency graph
                for dep in &symbol.dependencies {
                    self.dependencies
                        .entry(symbol_id.clone())
                        .or_default()
                        .push(Dependency {
                            from: symbol_id.clone(),
                            to: dep.clone(),
                            kind: ReferenceKind::TypeReference,
                        });
                }
            }
        }

        tracing::info!("Loaded {} symbols from storage", self.symbols.len());
        Ok(())
    }

    /// Index a single file
    async fn index_file(&mut self, path: &Path) -> Result<Vec<CodeSymbol>> {
        // Check if file should be ignored
        if self.should_ignore(path) {
            return Ok(Vec::new());
        }

        // Read file content
        let content = tokio::fs::read_to_string(path)
            .await
            .with_context(|| format!("Failed to read file: {:?}", path))?;

        // Cache the source
        self.source_cache
            .insert(path.to_path_buf(), content.clone());

        // Parse and extract symbols
        let mut symbols = self.parser.parse_file(path, &content)?;

        // Build dependencies between symbols in this file
        self.build_local_dependencies(&mut symbols);

        // Generate embeddings for each symbol
        for symbol in &mut symbols {
            // Create embedding text from symbol name, signature, and doc comment
            let embedding_text = format!(
                "{} {} {}",
                symbol.name,
                symbol.signature,
                symbol.metadata.doc_comment.as_deref().unwrap_or("")
            );

            // Generate embedding
            match self.embedding_engine.lock().unwrap().generate_embedding(&embedding_text) {
                Ok(embedding) => {
                    symbol.embedding = Some(embedding);
                }
                Err(e) => {
                    tracing::warn!("Failed to generate embedding for symbol {}: {}", symbol.name, e);
                }
            }
        }

        // Store symbols
        for symbol in &symbols {
            let key = format!("symbol:{}", symbol.id.0);
            let value = serialize(symbol)?;
            self.storage.put(key.as_bytes(), &value).await?;

            // Update caches
            self.symbols.insert(symbol.id.clone(), symbol.clone());

            self.name_index
                .entry(symbol.name.clone())
                .or_default()
                .push(symbol.id.clone());

            self.file_index
                .entry(path.to_path_buf())
                .or_default()
                .push(symbol.id.clone());
        }

        Ok(symbols)
    }

    /// Build dependencies between symbols in the same file
    fn build_local_dependencies(&mut self, symbols: &mut [CodeSymbol]) {
        // Build reverse lookup from symbol ID to name
        let id_to_name: HashMap<SymbolId, String> = symbols
            .iter()
            .map(|s| (s.id.clone(), s.name.clone()))
            .collect();

        let name_to_id: HashMap<String, SymbolId> = symbols
            .iter()
            .map(|s| (s.name.clone(), s.id.clone()))
            .collect();

        for symbol in symbols.iter_mut() {
            let mut deps = Vec::new();

            // Check references to other symbols
            for reference in &symbol.references.clone() {
                if let Some(name) = id_to_name.get(&reference.symbol_id) {
                    if let Some(target_id) = name_to_id.get(name) {
                        deps.push(target_id.clone());

                        // Also add to dependency graph
                        self.dependencies
                            .entry(symbol.id.clone())
                            .or_default()
                            .push(Dependency {
                                from: symbol.id.clone(),
                                to: target_id.clone(),
                                kind: reference.kind,
                            });
                    }
                }
            }

            symbol.dependencies = deps;
        }
    }

    /// Check if path should be ignored
    fn should_ignore(&self, path: &Path) -> bool {
        let path_str = path.to_string_lossy();

        for ignore in &self.config.ignore {
            if path_str.contains(ignore) {
                return true;
            }
        }

        false
    }

    /// Walk directory and index all files
    async fn walk_and_index(&mut self, root: &Path) -> Result<()> {
        use tokio::fs;

        let mut entries = fs::read_dir(root).await?;

        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();

            if path.is_dir() {
                if !self.should_ignore(&path) {
                    Box::pin(self.walk_and_index(&path)).await?;
                }
            } else if path.is_file() {
                // Check if file has supported extension
                if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
                    if self.config.languages.iter().any(|lang| {
                        matches!(
                            (lang.as_str(), ext),
                            ("rust", "rs")
                                | ("typescript", "ts" | "tsx")
                                | ("javascript", "js" | "jsx")
                                | ("python", "py")
                                | ("go", "go")
                        )
                    }) {
                        match self.index_file(&path).await {
                            Ok(_) => {}
                            Err(e) => {
                                tracing::warn!("Failed to index {:?}: {}", path, e);
                            }
                        }
                    }
                }
            }
        }

        Ok(())
    }

    /// Get full definition of a symbol including body
    pub async fn get_definition(
        &self,
        symbol_id: &SymbolId,
        include_body: bool,
        _include_references: bool,
        include_dependencies: bool,
    ) -> Result<Option<SymbolDefinition>> {
        let symbol = match self.symbols.get(symbol_id) {
            Some(s) => s.clone(),
            None => return Ok(None),
        };

        let mut body = None;
        if include_body {
            // Get the source code for this symbol
            let file_path = PathBuf::from(&symbol.location.file);
            if let Some(source) = self.source_cache.get(&file_path) {
                let lines: Vec<&str> = source.lines().collect();
                let start = (symbol.location.line_start - 1).min(lines.len());
                let end = symbol.location.line_end.min(lines.len());
                if start < end {
                    body = Some(lines[start..end].join("\n"));
                }
            } else {
                // Try to load from file if not in cache
                if let Ok(content) = tokio::fs::read_to_string(&file_path).await {
                    let lines: Vec<&str> = content.lines().collect();
                    let start = (symbol.location.line_start - 1).min(lines.len());
                    let end = symbol.location.line_end.min(lines.len());
                    if start < end {
                        body = Some(lines[start..end].join("\n"));
                    }
                    // Cache it
                    self.source_cache.insert(file_path, content);
                }
            }
        }

        let mut dependencies = Vec::new();
        if include_dependencies {
            for dep_id in &symbol.dependencies {
                if let Some(dep_symbol) = self.symbols.get(dep_id) {
                    dependencies.push(dep_symbol.clone());
                }
            }
        }

        Ok(Some(SymbolDefinition {
            symbol,
            body,
            dependencies,
        }))
    }

    /// Find all references to a symbol
    pub async fn find_references(&self, symbol_id: &SymbolId) -> Result<Vec<Reference>> {
        let mut references = Vec::new();

        // Look through all symbols to find references to this one
        for entry in self.symbols.iter() {
            let symbol = entry.value();
            for reference in &symbol.references {
                if &reference.symbol_id == symbol_id {
                    references.push(reference.clone());
                }
            }
        }

        Ok(references)
    }

    /// Build dependency graph from a symbol
    pub async fn get_dependencies(
        &self,
        entry_point: &SymbolId,
        depth: Option<usize>,
        direction: DependencyDirection,
    ) -> Result<DependencyGraph> {
        let max_depth = depth.unwrap_or(10);
        let mut nodes = HashSet::new();
        let mut edges = Vec::new();
        let mut visited = HashSet::new();
        let mut queue = vec![(entry_point.clone(), 0)];

        while let Some((current_id, current_depth)) = queue.pop() {
            if current_depth >= max_depth || visited.contains(&current_id) {
                continue;
            }

            visited.insert(current_id.clone());
            nodes.insert(current_id.clone());

            match direction {
                DependencyDirection::Imports => {
                    // Follow dependencies (what this symbol imports/uses)
                    if let Some(deps) = self.dependencies.get(&current_id) {
                        for dep in deps.iter() {
                            edges.push((dep.from.clone(), dep.to.clone(), dep.kind));
                            queue.push((dep.to.clone(), current_depth + 1));
                        }
                    }
                }
                DependencyDirection::Exports => {
                    // Follow reverse dependencies (what uses this symbol)
                    for entry in self.dependencies.iter() {
                        for dep in entry.value().iter() {
                            if dep.to == current_id {
                                edges.push((dep.from.clone(), dep.to.clone(), dep.kind));
                                queue.push((dep.from.clone(), current_depth + 1));
                            }
                        }
                    }
                }
                DependencyDirection::Both => {
                    // Both directions
                    if let Some(deps) = self.dependencies.get(&current_id) {
                        for dep in deps.iter() {
                            edges.push((dep.from.clone(), dep.to.clone(), dep.kind));
                            queue.push((dep.to.clone(), current_depth + 1));
                        }
                    }

                    for entry in self.dependencies.iter() {
                        for dep in entry.value().iter() {
                            if dep.to == current_id {
                                edges.push((dep.from.clone(), dep.to.clone(), dep.kind));
                                queue.push((dep.from.clone(), current_depth + 1));
                            }
                        }
                    }
                }
            }
        }

        Ok(DependencyGraph {
            nodes: nodes.into_iter().collect(),
            edges,
        })
    }

    /// Filter symbols by detail level
    fn apply_detail_level(&self, symbol: &CodeSymbol, level: DetailLevel) -> CodeSymbol {
        let mut filtered = symbol.clone();

        match level {
            DetailLevel::Skeleton => {
                // Only keep name and signature
                filtered.references = Vec::new();
                filtered.dependencies = Vec::new();
            }
            DetailLevel::Interface => {
                // Keep public interface
                filtered.references = Vec::new();
            }
            DetailLevel::Implementation => {
                // Keep most things
            }
            DetailLevel::Full => {
                // Keep everything
            }
        }

        filtered
    }

    /// Perform semantic search using vector embeddings
    pub async fn semantic_search(&self, query: &str, limit: usize) -> Result<Vec<CodeSymbol>> {
        // Generate embedding for the query
        let query_embedding = self.embedding_engine.lock().unwrap().generate_embedding(query)?;

        // Calculate cosine similarity for all symbols with embeddings
        let mut scored_symbols: Vec<(CodeSymbol, f32)> = Vec::new();

        for entry in self.symbols.iter() {
            let symbol = entry.value();

            if let Some(ref embedding) = symbol.embedding {
                let similarity = EmbeddingEngine::cosine_similarity(&query_embedding, embedding);
                scored_symbols.push((symbol.clone(), similarity));
            }
        }

        // Sort by similarity score (highest first)
        scored_symbols.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        // Take top N results
        let results: Vec<CodeSymbol> = scored_symbols
            .into_iter()
            .take(limit)
            .map(|(symbol, _score)| symbol)
            .collect();

        Ok(results)
    }

    /// Hybrid search combining text-based and semantic search
    pub async fn hybrid_search(&self, query: &Query) -> Result<QueryResult> {
        let limit = query.max_results.unwrap_or(10);

        // Get text-based search results
        let text_results = self.search_symbols(query).await?;

        // Get semantic search results
        let semantic_results = self.semantic_search(&query.text, limit).await?;

        // Combine and deduplicate results
        let mut seen_ids = HashSet::new();
        let mut combined_symbols = Vec::new();
        let mut total_tokens = TokenCount::zero();

        // Add text results first (they are more precise)
        for symbol in text_results.symbols {
            if !seen_ids.contains(&symbol.id) {
                seen_ids.insert(symbol.id.clone());

                // Apply filters
                if let Some(ref types) = query.symbol_types {
                    if !types.contains(&symbol.kind) {
                        continue;
                    }
                }

                if let Some(ref scope) = query.scope {
                    if !symbol.location.file.starts_with(scope) {
                        continue;
                    }
                }

                // Check token budget
                if let Some(max_tokens) = query.max_tokens {
                    if total_tokens.0 + symbol.metadata.token_cost.0 > max_tokens.0 {
                        break;
                    }
                }

                total_tokens.add(symbol.metadata.token_cost);
                combined_symbols.push(symbol);

                if combined_symbols.len() >= limit {
                    break;
                }
            }
        }

        // Add semantic results to fill remaining slots
        for symbol in semantic_results {
            if combined_symbols.len() >= limit {
                break;
            }

            if !seen_ids.contains(&symbol.id) {
                seen_ids.insert(symbol.id.clone());

                // Apply filters
                if let Some(ref types) = query.symbol_types {
                    if !types.contains(&symbol.kind) {
                        continue;
                    }
                }

                if let Some(ref scope) = query.scope {
                    if !symbol.location.file.starts_with(scope) {
                        continue;
                    }
                }

                // Apply detail level
                let filtered = self.apply_detail_level(&symbol, query.detail_level);

                // Check token budget
                if let Some(max_tokens) = query.max_tokens {
                    if total_tokens.0 + filtered.metadata.token_cost.0 > max_tokens.0 {
                        break;
                    }
                }

                total_tokens.add(filtered.metadata.token_cost);
                combined_symbols.push(filtered);
            }
        }

        let truncated = query.max_tokens.is_some_and(|max| total_tokens > max)
            || combined_symbols.len() >= limit;

        Ok(QueryResult {
            symbols: combined_symbols,
            total_tokens,
            truncated,
        })
    }
}

#[derive(Debug, Clone, Copy)]
pub enum DependencyDirection {
    Imports,
    Exports,
    Both,
}

#[async_trait::async_trait]
impl Indexer for CodeIndexer {
    async fn index_project(&mut self, path: &Path, force: bool) -> Result<()> {
        if force {
            self.symbols.clear();
            self.name_index.clear();
            self.file_index.clear();
            self.dependencies.clear();
            self.source_cache.clear();
        }

        tracing::info!("Indexing project at {:?}", path);
        self.walk_and_index(path).await?;
        tracing::info!("Indexed {} symbols", self.symbols.len());

        Ok(())
    }

    async fn search_symbols(&self, query: &Query) -> Result<QueryResult> {
        let mut matching_symbols = Vec::new();
        let mut total_tokens = TokenCount::zero();

        // First, try exact name match
        if let Some(symbol_ids) = self.name_index.get(&query.text) {
            for symbol_id in symbol_ids.iter() {
                if let Some(symbol) = self.symbols.get(symbol_id) {
                    // Apply filters
                    if let Some(ref types) = query.symbol_types {
                        if !types.contains(&symbol.kind) {
                            continue;
                        }
                    }

                    if let Some(ref scope) = query.scope {
                        if !symbol.location.file.starts_with(scope) {
                            continue;
                        }
                    }

                    // Apply detail level
                    #[allow(clippy::needless_borrow)]
                    let filtered = self.apply_detail_level(&symbol, query.detail_level);

                    // Check token budget
                    if let Some(max_tokens) = query.max_tokens {
                        if total_tokens.0 + filtered.metadata.token_cost.0 > max_tokens.0 {
                            break;
                        }
                    }

                    total_tokens.add(filtered.metadata.token_cost);
                    matching_symbols.push(filtered);

                    if let Some(max_results) = query.max_results {
                        if matching_symbols.len() >= max_results {
                            break;
                        }
                    }
                }
            }
        }

        // If no exact matches, do fuzzy search
        if matching_symbols.is_empty() {
            let query_lower = query.text.to_lowercase();

            for entry in self.symbols.iter() {
                let symbol = entry.value();

                // Check if query matches name or signature
                let name_lower = symbol.name.to_lowercase();
                let sig_lower = symbol.signature.to_lowercase();

                if !name_lower.contains(&query_lower) && !sig_lower.contains(&query_lower) {
                    continue;
                }

                // Apply filters
                if let Some(ref types) = query.symbol_types {
                    if !types.contains(&symbol.kind) {
                        continue;
                    }
                }

                if let Some(ref scope) = query.scope {
                    if !symbol.location.file.starts_with(scope) {
                        continue;
                    }
                }

                // Apply detail level
                #[allow(clippy::needless_borrow)]
                let filtered = self.apply_detail_level(&symbol, query.detail_level);

                // Check token budget
                if let Some(max_tokens) = query.max_tokens {
                    if total_tokens.0 + filtered.metadata.token_cost.0 > max_tokens.0 {
                        break;
                    }
                }

                total_tokens.add(filtered.metadata.token_cost);
                matching_symbols.push(filtered);

                if let Some(max_results) = query.max_results {
                    if matching_symbols.len() >= max_results {
                        break;
                    }
                }
            }
        }

        let truncated = query.max_tokens.is_some_and(|max| total_tokens > max)
            || query
                .max_results
                .is_some_and(|max| matching_symbols.len() >= max);

        Ok(QueryResult {
            symbols: matching_symbols,
            total_tokens,
            truncated,
        })
    }

    async fn get_symbol(&self, id: &str) -> Result<Option<CodeSymbol>> {
        let symbol_id = SymbolId::new(id);
        Ok(self.symbols.get(&symbol_id).map(|s| s.clone()))
    }

    async fn update_file(&mut self, path: &Path) -> Result<()> {
        // Remove old symbols for this file
        if let Some(old_symbols) = self.file_index.get(path) {
            for symbol_id in old_symbols.iter() {
                self.symbols.remove(symbol_id);

                // Remove from name index
                for mut entry in self.name_index.iter_mut() {
                    entry.value_mut().retain(|id| id != symbol_id);
                }

                // Remove from dependencies
                self.dependencies.remove(symbol_id);
            }
        }
        self.file_index.remove(path);

        // Clear source cache
        self.source_cache.remove(path);

        // Re-index the file
        self.index_file(path).await?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::IndexConfig;
    use crate::storage::RocksDBStorage;
    use crate::types::SymbolKind;
    use tempfile::TempDir;

    async fn setup_test_indexer() -> (CodeIndexer, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let storage = Arc::new(RocksDBStorage::new(temp_dir.path()).unwrap());
        let config = IndexConfig {
            languages: vec!["rust".to_string(), "typescript".to_string()],
            ignore: vec!["target".to_string(), "node_modules".to_string()],
            max_file_size: "1MB".to_string(),
        };

        let indexer = CodeIndexer::new(storage, config).unwrap();
        (indexer, temp_dir)
    }

    #[tokio::test]
    async fn test_index_and_search() {
        let (mut indexer, _temp) = setup_test_indexer().await;

        // Create a test file
        let test_dir = TempDir::new().unwrap();
        let test_file = test_dir.path().join("test.rs");
        tokio::fs::write(
            &test_file,
            r#"
            pub fn test_function(x: i32) -> i32 {
                x + 1
            }

            pub struct TestStruct {
                field: i32,
            }
            "#,
        )
        .await
        .unwrap();

        // Index the directory
        indexer.index_project(test_dir.path(), false).await.unwrap();

        // Search for function
        let query = Query::new("test_function".to_string());
        let result = indexer.search_symbols(&query).await.unwrap();

        assert!(!result.symbols.is_empty());
        assert!(result
            .symbols
            .iter()
            .any(|s| s.name == "test_function" && s.kind == SymbolKind::Function));
    }

    #[tokio::test]
    async fn test_get_definition() {
        let (mut indexer, _temp) = setup_test_indexer().await;

        // Create and index a test file
        let test_dir = TempDir::new().unwrap();
        let test_file = test_dir.path().join("test.rs");
        tokio::fs::write(
            &test_file,
            r#"
            pub fn test_function(x: i32) -> i32 {
                x + 1
            }
            "#,
        )
        .await
        .unwrap();

        indexer.index_project(test_dir.path(), false).await.unwrap();

        // Find the symbol
        let query = Query::new("test_function".to_string());
        let result = indexer.search_symbols(&query).await.unwrap();
        let symbol = result.symbols.first().unwrap();

        // Get full definition
        let definition = indexer
            .get_definition(&symbol.id, true, false, false)
            .await
            .unwrap()
            .unwrap();

        assert!(definition.body.is_some());
        assert!(definition.body.unwrap().contains("x + 1"));
    }

    #[tokio::test]
    async fn test_dependency_graph() {
        let (mut indexer, _temp) = setup_test_indexer().await;

        // Create test file with dependencies
        let test_dir = TempDir::new().unwrap();
        let test_file = test_dir.path().join("test.rs");
        tokio::fs::write(
            &test_file,
            r#"
            pub struct User {
                name: String,
            }

            pub fn create_user(name: String) -> User {
                User { name }
            }
            "#,
        )
        .await
        .unwrap();

        indexer.index_project(test_dir.path(), false).await.unwrap();

        // Find create_user function
        let query = Query::new("create_user".to_string());
        let result = indexer.search_symbols(&query).await.unwrap();
        let symbol = result.symbols.first().unwrap();

        // Get dependencies
        let graph = indexer
            .get_dependencies(&symbol.id, Some(5), DependencyDirection::Both)
            .await
            .unwrap();

        assert!(!graph.nodes.is_empty());
    }
}
