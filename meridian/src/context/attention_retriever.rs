use crate::storage::Storage;
use crate::types::{
    AttentionHistoryEntry, AttentionPattern, CodeSymbol, ContextQuery, PredictedFocus, SymbolId,
    TokenCount,
};
use anyhow::{Context as AnyhowContext, Result};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::RwLock;

const MAX_HISTORY_SIZE: usize = 1000;
const HISTORY_STORAGE_KEY: &[u8] = b"attention:history";
const PREDICTOR_MODEL_KEY: &[u8] = b"attention:predictor_model";

/// Attention history tracker
pub struct AttentionHistory {
    entries: VecDeque<AttentionHistoryEntry>,
    symbol_frequency: HashMap<SymbolId, f32>,
    co_occurrence: HashMap<(SymbolId, SymbolId), usize>,
    storage: Arc<dyn Storage>,
}

impl AttentionHistory {
    pub fn new(storage: Arc<dyn Storage>) -> Self {
        Self {
            entries: VecDeque::with_capacity(MAX_HISTORY_SIZE),
            symbol_frequency: HashMap::new(),
            co_occurrence: HashMap::new(),
            storage,
        }
    }

    /// Add a new attention pattern to history
    pub async fn record(&mut self, pattern: AttentionPattern, query_context: String) -> Result<()> {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)?
            .as_secs();

        let entry = AttentionHistoryEntry {
            timestamp,
            pattern: pattern.clone(),
            query_context,
        };

        // Update symbol frequency
        for (symbol, weight) in &pattern.focused_symbols {
            *self.symbol_frequency.entry(symbol.clone()).or_insert(0.0) += weight;
        }

        // Update co-occurrence matrix
        let symbols: Vec<_> = pattern.focused_symbols.keys().collect();
        for i in 0..symbols.len() {
            for j in (i + 1)..symbols.len() {
                let pair = (symbols[i].clone(), symbols[j].clone());
                *self.co_occurrence.entry(pair).or_insert(0) += 1;
            }
        }

        // Add to history
        self.entries.push_back(entry);
        if self.entries.len() > MAX_HISTORY_SIZE {
            if let Some(old_entry) = self.entries.pop_front() {
                // Decay old symbol frequencies
                for (symbol, weight) in &old_entry.pattern.focused_symbols {
                    if let Some(freq) = self.symbol_frequency.get_mut(symbol) {
                        *freq = (*freq - weight).max(0.0);
                    }
                }
            }
        }

        // Persist to storage
        self.save_to_storage().await?;

        Ok(())
    }

    /// Analyze patterns based on query
    pub fn analyze_pattern(&self, query: &ContextQuery) -> AttentionPattern {
        let mut focused = HashMap::new();
        let mut predicted = Vec::new();

        // Analyze recent attention patterns
        let recent_entries: Vec<_> = self
            .entries
            .iter()
            .rev()
            .take(50)
            .collect();

        // Calculate attention weights based on frequency and recency
        for entry in recent_entries {
            let age_weight = Self::calculate_age_weight(entry.timestamp);

            for (symbol, weight) in &entry.pattern.focused_symbols {
                // Check if symbol is relevant to current query
                let relevance = if query.symbols.contains(symbol) {
                    1.0
                } else {
                    self.calculate_symbol_relevance(symbol, &query.symbols)
                };

                if relevance > 0.1 {
                    *focused.entry(symbol.clone()).or_insert(0.0) +=
                        weight * age_weight * relevance;
                }
            }

            // Add predicted symbols
            for symbol in &entry.pattern.predicted_next {
                if !predicted.contains(symbol) && !query.symbols.contains(symbol) {
                    predicted.push(symbol.clone());
                }
            }
        }

        AttentionPattern {
            focused_symbols: focused,
            predicted_next: predicted,
        }
    }

    /// Calculate relevance based on co-occurrence
    fn calculate_symbol_relevance(&self, symbol: &SymbolId, context_symbols: &[SymbolId]) -> f32 {
        let mut relevance = 0.0;
        let mut total_weight = 0.0;

        for context_symbol in context_symbols {
            let pair1 = (symbol.clone(), context_symbol.clone());
            let pair2 = (context_symbol.clone(), symbol.clone());

            let co_occur = self.co_occurrence.get(&pair1).or_else(|| self.co_occurrence.get(&pair2))
                .copied()
                .unwrap_or(0);

            if co_occur > 0 {
                relevance += co_occur as f32;
                total_weight += 1.0;
            }
        }

        if total_weight > 0.0 {
            (relevance / total_weight).min(1.0)
        } else {
            0.0
        }
    }

    /// Calculate weight based on entry age
    fn calculate_age_weight(timestamp: u64) -> f32 {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let age_seconds = now.saturating_sub(timestamp) as f32;
        let age_hours = age_seconds / 3600.0;

        // Exponential decay: weight = e^(-t/24) where t is in hours
        (-age_hours / 24.0).exp()
    }

    /// Get most frequent symbols
    pub fn get_frequent_symbols(&self, limit: usize) -> Vec<(SymbolId, f32)> {
        let mut freq_vec: Vec<_> = self.symbol_frequency.iter()
            .map(|(k, v)| (k.clone(), *v))
            .collect();
        freq_vec.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        freq_vec.into_iter().take(limit).collect()
    }

    /// Save history to storage
    async fn save_to_storage(&self) -> Result<()> {
        let data = serde_json::to_vec(&self.entries)?;
        self.storage.put(HISTORY_STORAGE_KEY, &data).await?;
        Ok(())
    }

    /// Load history from storage
    pub async fn load_from_storage(storage: Arc<dyn Storage>) -> Result<Self> {
        let mut history = Self::new(storage);

        if let Some(data) = history.storage.get(HISTORY_STORAGE_KEY).await? {
            let entries: VecDeque<AttentionHistoryEntry> = serde_json::from_slice(&data)?;
            history.entries = entries;

            // Rebuild frequency and co-occurrence maps
            for entry in &history.entries {
                for (symbol, weight) in &entry.pattern.focused_symbols {
                    *history.symbol_frequency.entry(symbol.clone()).or_insert(0.0) += weight;
                }

                let symbols: Vec<_> = entry.pattern.focused_symbols.keys().collect();
                for i in 0..symbols.len() {
                    for j in (i + 1)..symbols.len() {
                        let pair = (symbols[i].clone(), symbols[j].clone());
                        *history.co_occurrence.entry(pair).or_insert(0) += 1;
                    }
                }
            }
        }

        Ok(history)
    }
}

/// Attention predictor model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttentionPredictorModel {
    /// Transition probabilities: symbol -> (next_symbol, probability)
    transitions: HashMap<SymbolId, Vec<(SymbolId, f32)>>,
    /// Global symbol importance
    importance: HashMap<SymbolId, f32>,
}

impl Default for AttentionPredictorModel {
    fn default() -> Self {
        Self {
            transitions: HashMap::new(),
            importance: HashMap::new(),
        }
    }
}

pub struct AttentionPredictor {
    model: AttentionPredictorModel,
    storage: Arc<dyn Storage>,
}

impl AttentionPredictor {
    pub fn new(storage: Arc<dyn Storage>) -> Self {
        Self {
            model: AttentionPredictorModel::default(),
            storage,
        }
    }

    /// Train the predictor model from attention history
    pub fn train(&mut self, history: &AttentionHistory) {
        self.model = AttentionPredictorModel::default();

        // Calculate transitions from history
        let entries: Vec<_> = history.entries.iter().collect();
        for window in entries.windows(2) {
            let current = &window[0].pattern;
            let next = &window[1].pattern;

            for current_symbol in current.focused_symbols.keys() {
                let transitions = self.model.transitions
                    .entry(current_symbol.clone())
                    .or_insert_with(Vec::new);

                for next_symbol in next.focused_symbols.keys() {
                    if let Some((_sym, prob)) = transitions.iter_mut()
                        .find(|(s, _)| s == next_symbol) {
                        *prob += 1.0;
                    } else {
                        transitions.push((next_symbol.clone(), 1.0));
                    }
                }
            }
        }

        // Normalize transition probabilities
        for transitions in self.model.transitions.values_mut() {
            let total: f32 = transitions.iter().map(|(_, p)| p).sum();
            if total > 0.0 {
                for (_, prob) in transitions.iter_mut() {
                    *prob /= total;
                }
            }
        }

        // Calculate global importance from frequency
        for (symbol, freq) in &history.symbol_frequency {
            self.model.importance.insert(symbol.clone(), *freq);
        }

        // Normalize importance
        let max_importance = self.model.importance.values().copied()
            .fold(0.0f32, f32::max);
        if max_importance > 0.0 {
            for importance in self.model.importance.values_mut() {
                *importance /= max_importance;
            }
        }
    }

    /// Predict next symbols based on current attention pattern
    pub fn predict(&self, pattern: &AttentionPattern) -> PredictedFocus {
        let mut high_prob = Vec::new();
        let mut medium_prob = Vec::new();
        let mut context = Vec::new();

        // Collect predicted symbols with scores
        let mut predictions: HashMap<SymbolId, f32> = HashMap::new();

        // Use transition probabilities
        for current_symbol in pattern.focused_symbols.keys() {
            if let Some(transitions) = self.model.transitions.get(current_symbol) {
                for (next_symbol, prob) in transitions {
                    *predictions.entry(next_symbol.clone()).or_insert(0.0) += prob;
                }
            }
        }

        // Add symbols from pattern's predicted_next with high scores
        for symbol in &pattern.predicted_next {
            *predictions.entry(symbol.clone()).or_insert(0.0) += 0.8;
        }

        // Sort by prediction score
        let mut pred_vec: Vec<_> = predictions.into_iter().collect();
        pred_vec.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        // Categorize predictions
        let mut confidence_sum = 0.0;
        let mut count = 0;

        for (symbol, score) in pred_vec {
            if !pattern.focused_symbols.contains_key(&symbol) {
                if score > 0.6 {
                    high_prob.push(symbol);
                } else if score > 0.3 {
                    medium_prob.push(symbol);
                } else if score > 0.1 {
                    context.push(symbol);
                }

                confidence_sum += score;
                count += 1;
            }
        }

        let confidence = if count > 0 {
            (confidence_sum / count as f32).min(1.0)
        } else {
            0.0
        };

        PredictedFocus {
            high_probability: high_prob,
            medium_probability: medium_prob,
            context,
            confidence,
        }
    }

    /// Save model to storage
    pub async fn save_to_storage(&self) -> Result<()> {
        let data = serde_json::to_vec(&self.model)?;
        self.storage.put(PREDICTOR_MODEL_KEY, &data).await?;
        Ok(())
    }

    /// Load model from storage
    pub async fn load_from_storage(storage: Arc<dyn Storage>) -> Result<Self> {
        let mut predictor = Self::new(storage);

        if let Some(data) = predictor.storage.get(PREDICTOR_MODEL_KEY).await? {
            predictor.model = serde_json::from_slice(&data)?;
        }

        Ok(predictor)
    }
}

/// LRU cache for predicted symbols
pub struct PredictiveCache {
    cache: HashMap<SymbolId, CodeSymbol>,
    access_order: VecDeque<SymbolId>,
    capacity: usize,
}

impl PredictiveCache {
    pub fn new(capacity: usize) -> Self {
        Self {
            cache: HashMap::new(),
            access_order: VecDeque::with_capacity(capacity),
            capacity,
        }
    }

    /// Get symbol from cache
    pub fn get(&mut self, symbol_id: &SymbolId) -> Option<&CodeSymbol> {
        if self.cache.contains_key(symbol_id) {
            // Move to back (most recently used)
            self.access_order.retain(|id| id != symbol_id);
            self.access_order.push_back(symbol_id.clone());
            self.cache.get(symbol_id)
        } else {
            None
        }
    }

    /// Put symbol into cache
    pub fn put(&mut self, symbol: CodeSymbol) {
        let symbol_id = symbol.id.clone();

        // Remove if already exists
        if self.cache.contains_key(&symbol_id) {
            self.access_order.retain(|id| id != &symbol_id);
        }

        // Evict LRU if at capacity
        if self.cache.len() >= self.capacity && !self.cache.contains_key(&symbol_id) {
            if let Some(lru_id) = self.access_order.pop_front() {
                self.cache.remove(&lru_id);
            }
        }

        // Add new symbol
        self.cache.insert(symbol_id.clone(), symbol);
        self.access_order.push_back(symbol_id);
    }

    /// Preload symbols
    pub fn preload(&mut self, symbols: Vec<CodeSymbol>) {
        for symbol in symbols {
            self.put(symbol);
        }
    }

    /// Clear cache
    pub fn clear(&mut self) {
        self.cache.clear();
        self.access_order.clear();
    }

    /// Get cache size
    pub fn len(&self) -> usize {
        self.cache.len()
    }

    /// Check if empty
    pub fn is_empty(&self) -> bool {
        self.cache.is_empty()
    }
}

/// Priority level for symbol retrieval
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Priority {
    High,
    Medium,
    Context,
}

/// Attention-based retrieval system
pub struct AttentionBasedRetriever {
    attention_history: Arc<RwLock<AttentionHistory>>,
    prediction_model: Arc<RwLock<AttentionPredictor>>,
    cache: Arc<RwLock<PredictiveCache>>,
    storage: Arc<dyn Storage>,
}

impl AttentionBasedRetriever {
    pub async fn new(storage: Arc<dyn Storage>) -> Result<Self> {
        let history = AttentionHistory::load_from_storage(storage.clone())
            .await
            .context("Failed to load attention history")?;

        let predictor = AttentionPredictor::load_from_storage(storage.clone())
            .await
            .context("Failed to load attention predictor")?;

        Ok(Self {
            attention_history: Arc::new(RwLock::new(history)),
            prediction_model: Arc::new(RwLock::new(predictor)),
            cache: Arc::new(RwLock::new(PredictiveCache::new(1000))),
            storage,
        })
    }

    /// Record attention pattern
    pub async fn record_attention(
        &self,
        pattern: AttentionPattern,
        query_context: String,
    ) -> Result<()> {
        let mut history = self.attention_history.write().await;
        history.record(pattern, query_context).await?;

        // Retrain predictor periodically (every 10 patterns)
        if history.entries.len() % 10 == 0 {
            let mut predictor = self.prediction_model.write().await;
            predictor.train(&history);
            predictor.save_to_storage().await?;
        }

        Ok(())
    }

    /// Retrieve symbols based on attention patterns
    pub async fn retrieve(
        &self,
        query: ContextQuery,
        token_budget: TokenCount,
    ) -> Result<RetrievalResult> {
        let history = self.attention_history.read().await;
        let predictor = self.prediction_model.read().await;

        // Analyze current attention pattern
        let attention_pattern = history.analyze_pattern(&query);

        // Predict next symbols
        let predicted_focus = predictor.predict(&attention_pattern);

        // Build retrieval result with token budget awareness
        let mut result = RetrievalResult {
            high_attention: Vec::new(),
            medium_attention: Vec::new(),
            context_symbols: Vec::new(),
            total_tokens: TokenCount::zero(),
            token_budget,
            truncated: false,
        };

        // Priority 1: High probability symbols
        result.add_symbols_with_priority(
            predicted_focus.high_probability,
            Priority::High,
        );

        // Priority 2: Medium probability symbols (if budget allows)
        if result.has_token_budget() {
            result.add_symbols_with_priority(
                predicted_focus.medium_probability,
                Priority::Medium,
            );
        }

        // Priority 3: Context symbols (if budget allows)
        if result.has_token_budget() {
            result.add_symbols_with_priority(
                predicted_focus.context,
                Priority::Context,
            );
        }

        Ok(result)
    }

    /// Train the prediction model
    pub async fn train(&self) -> Result<()> {
        let history = self.attention_history.read().await;
        let mut predictor = self.prediction_model.write().await;
        predictor.train(&history);
        predictor.save_to_storage().await?;
        Ok(())
    }

    /// Clear cache
    pub async fn clear_cache(&self) {
        let mut cache = self.cache.write().await;
        cache.clear();
    }

    /// Get statistics
    pub async fn get_stats(&self) -> RetrievalStats {
        let history = self.attention_history.read().await;
        let cache = self.cache.read().await;

        RetrievalStats {
            history_size: history.entries.len(),
            cache_size: cache.len(),
            frequent_symbols: history.get_frequent_symbols(10),
        }
    }
}

/// Result of attention-based retrieval
#[derive(Debug, Clone)]
pub struct RetrievalResult {
    pub high_attention: Vec<SymbolId>,
    pub medium_attention: Vec<SymbolId>,
    pub context_symbols: Vec<SymbolId>,
    pub total_tokens: TokenCount,
    pub token_budget: TokenCount,
    pub truncated: bool,
}

impl RetrievalResult {
    fn add_symbols_with_priority(&mut self, symbols: Vec<SymbolId>, priority: Priority) {
        let estimated_tokens_per_symbol = 100; // Conservative estimate

        for symbol in symbols {
            let estimated_cost = TokenCount::new(estimated_tokens_per_symbol);

            if self.total_tokens.0 + estimated_cost.0 <= self.token_budget.0 {
                match priority {
                    Priority::High => self.high_attention.push(symbol),
                    Priority::Medium => self.medium_attention.push(symbol),
                    Priority::Context => self.context_symbols.push(symbol),
                }
                self.total_tokens.0 += estimated_cost.0;
            } else {
                self.truncated = true;
                break;
            }
        }
    }

    fn has_token_budget(&self) -> bool {
        self.total_tokens.0 < self.token_budget.0
    }

    /// Get all symbols in priority order
    pub fn all_symbols(&self) -> Vec<SymbolId> {
        let mut result = Vec::new();
        result.extend(self.high_attention.iter().cloned());
        result.extend(self.medium_attention.iter().cloned());
        result.extend(self.context_symbols.iter().cloned());
        result
    }
}

/// Statistics about retrieval system
#[derive(Debug, Clone)]
pub struct RetrievalStats {
    pub history_size: usize,
    pub cache_size: usize,
    pub frequent_symbols: Vec<(SymbolId, f32)>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::rocksdb_storage::RocksDBStorage;
    use tempfile::TempDir;

    async fn create_test_storage() -> (Arc<dyn Storage>, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let storage = RocksDBStorage::new(temp_dir.path())
            .unwrap();
        (Arc::new(storage), temp_dir)
    }

    #[tokio::test]
    async fn test_attention_history_record() {
        let (storage, _temp) = create_test_storage().await;
        let mut history = AttentionHistory::new(storage);

        let mut focused = HashMap::new();
        focused.insert(SymbolId::new("sym1"), 0.8);
        focused.insert(SymbolId::new("sym2"), 0.6);

        let pattern = AttentionPattern {
            focused_symbols: focused,
            predicted_next: vec![SymbolId::new("sym3")],
        };

        history.record(pattern, "test query".to_string()).await.unwrap();

        assert_eq!(history.entries.len(), 1);
        assert!(history.symbol_frequency.contains_key(&SymbolId::new("sym1")));
    }

    #[tokio::test]
    async fn test_attention_predictor_train() {
        let (storage, _temp) = create_test_storage().await;
        let mut history = AttentionHistory::new(storage.clone());

        // Add some patterns
        for i in 0..5 {
            let mut focused = HashMap::new();
            focused.insert(SymbolId::new(format!("sym{}", i)), 0.8);
            focused.insert(SymbolId::new(format!("sym{}", i + 1)), 0.5);

            let pattern = AttentionPattern {
                focused_symbols: focused,
                predicted_next: vec![],
            };

            history.record(pattern, format!("query {}", i)).await.unwrap();
        }

        let mut predictor = AttentionPredictor::new(storage);
        predictor.train(&history);

        assert!(!predictor.model.transitions.is_empty());
    }

    #[tokio::test]
    async fn test_predictive_cache() {
        use crate::types::symbol::{CodeSymbol, SymbolKind, SymbolMetadata};

        let mut cache = PredictiveCache::new(3);

        let sym1 = CodeSymbol {
            id: SymbolId::new("sym1"),
            name: "Symbol1".to_string(),
            kind: SymbolKind::Function,
            signature: "fn test()".to_string(),
            body_hash: crate::types::Hash::from_string("hash1"),
            location: crate::types::Location::new("test.rs".to_string(), 1, 1, 0, 0),
            references: vec![],
            dependencies: vec![],
            metadata: SymbolMetadata {
                complexity: 1,
                token_cost: TokenCount::new(10),
                last_modified: None,
                authors: vec![],
                doc_comment: None,
                test_coverage: 0.0,
                usage_frequency: 0,
            },
            embedding: None,
        };

        cache.put(sym1.clone());
        assert_eq!(cache.len(), 1);

        let retrieved = cache.get(&SymbolId::new("sym1"));
        assert!(retrieved.is_some());
    }

    #[tokio::test]
    async fn test_retrieval_result_token_budget() {
        let mut result = RetrievalResult {
            high_attention: Vec::new(),
            medium_attention: Vec::new(),
            context_symbols: Vec::new(),
            total_tokens: TokenCount::zero(),
            token_budget: TokenCount::new(300),
            truncated: false,
        };

        let symbols = vec![
            SymbolId::new("sym1"),
            SymbolId::new("sym2"),
            SymbolId::new("sym3"),
            SymbolId::new("sym4"), // This should be truncated
        ];

        result.add_symbols_with_priority(symbols, Priority::High);

        assert_eq!(result.high_attention.len(), 3);
        assert!(result.truncated);
    }
}
