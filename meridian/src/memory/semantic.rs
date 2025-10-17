use crate::storage::{deserialize, serialize, Storage};
use crate::types::{ArchitectureKnowledge, CodePattern, CodingConvention, Outcome, SymbolId, TaskEpisode};
use anyhow::Result;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

/// Symbol relationship in the knowledge graph
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SymbolRelationship {
    pub from: SymbolId,
    pub to: SymbolId,
    pub relationship_type: RelationshipType,
    pub strength: f32, // 0.0 to 1.0
    pub frequency: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum RelationshipType {
    Imports,
    Calls,
    Implements,
    Extends,
    Uses,
    DependsOn,
}

/// Knowledge graph for symbol relationships
#[derive(Debug, Clone)]
struct KnowledgeGraph {
    /// Adjacency list: symbol -> related symbols
    edges: HashMap<SymbolId, Vec<SymbolRelationship>>,
    /// Reverse index for quick lookup
    reverse_edges: HashMap<SymbolId, Vec<SymbolRelationship>>,
}

impl KnowledgeGraph {
    fn new() -> Self {
        Self {
            edges: HashMap::new(),
            reverse_edges: HashMap::new(),
        }
    }

    fn add_relationship(&mut self, rel: SymbolRelationship) {
        self.edges
            .entry(rel.from.clone())
            .or_insert_with(Vec::new)
            .push(rel.clone());

        self.reverse_edges
            .entry(rel.to.clone())
            .or_insert_with(Vec::new)
            .push(rel);
    }

    fn get_related(&self, symbol: &SymbolId) -> Vec<&SymbolRelationship> {
        self.edges
            .get(symbol)
            .map(|v| v.iter().collect())
            .unwrap_or_default()
    }

    fn get_dependents(&self, symbol: &SymbolId) -> Vec<&SymbolRelationship> {
        self.reverse_edges
            .get(symbol)
            .map(|v| v.iter().collect())
            .unwrap_or_default()
    }

    fn find_path(&self, from: &SymbolId, to: &SymbolId, max_depth: usize) -> Option<Vec<SymbolId>> {
        let mut visited = HashSet::new();
        let mut queue = vec![(from.clone(), vec![from.clone()])];

        while let Some((current, path)) = queue.pop() {
            if &current == to {
                return Some(path);
            }

            if path.len() >= max_depth || visited.contains(&current) {
                continue;
            }

            visited.insert(current.clone());

            if let Some(rels) = self.edges.get(&current) {
                for rel in rels {
                    let mut new_path = path.clone();
                    new_path.push(rel.to.clone());
                    queue.insert(0, (rel.to.clone(), new_path));
                }
            }
        }

        None
    }
}

/// Semantic memory - generalized knowledge about patterns and architecture
pub struct SemanticMemory {
    storage: Arc<dyn Storage>,
    patterns: Vec<CodePattern>,
    architectures: Vec<ArchitectureKnowledge>,
    conventions: Vec<CodingConvention>,
    knowledge_graph: KnowledgeGraph,
    consolidation_threshold: f32,
}

impl SemanticMemory {
    pub fn new(storage: Arc<dyn Storage>) -> Result<Self> {
        Ok(Self {
            storage,
            patterns: Vec::new(),
            architectures: Vec::new(),
            conventions: Vec::new(),
            knowledge_graph: KnowledgeGraph::new(),
            consolidation_threshold: 0.8,
        })
    }

    /// Load semantic memory from storage
    pub async fn load(&mut self) -> Result<()> {
        // Load patterns
        let pattern_keys = self.storage.get_keys_with_prefix(b"pattern:").await?;
        for key in pattern_keys {
            if let Some(data) = self.storage.get(&key).await? {
                let pattern: CodePattern = deserialize(&data)?;
                self.patterns.push(pattern);
            }
        }

        // Load architectures
        let arch_keys = self.storage.get_keys_with_prefix(b"architecture:").await?;
        for key in arch_keys {
            if let Some(data) = self.storage.get(&key).await? {
                let arch: ArchitectureKnowledge = deserialize(&data)?;
                self.architectures.push(arch);
            }
        }

        // Load conventions
        let conv_keys = self.storage.get_keys_with_prefix(b"convention:").await?;
        for key in conv_keys {
            if let Some(data) = self.storage.get(&key).await? {
                let conv: CodingConvention = deserialize(&data)?;
                self.conventions.push(conv);
            }
        }

        // Load relationships
        let rel_keys = self.storage.get_keys_with_prefix(b"relationship:").await?;
        for key in rel_keys {
            if let Some(data) = self.storage.get(&key).await? {
                let rel: SymbolRelationship = deserialize(&data)?;
                self.knowledge_graph.add_relationship(rel);
            }
        }

        tracing::info!(
            "Loaded {} patterns, {} architectures, {} conventions, {} relationships",
            self.patterns.len(),
            self.architectures.len(),
            self.conventions.len(),
            self.knowledge_graph.edges.len()
        );
        Ok(())
    }

    /// Learn patterns from successful episodes
    pub async fn learn_patterns(&mut self, episodes: &[TaskEpisode]) -> Result<()> {
        let successful_episodes: Vec<_> = episodes
            .iter()
            .filter(|e| e.outcome == Outcome::Success)
            .collect();

        if successful_episodes.is_empty() {
            return Ok(());
        }

        // Extract patterns from episodes
        let mut extracted_patterns = HashMap::<String, Vec<CodePattern>>::new();

        for episode in successful_episodes {
            let patterns = self.extract_episode_patterns(episode);
            for pattern in patterns {
                let key = self.pattern_key(&pattern);
                extracted_patterns
                    .entry(key)
                    .or_insert_with(Vec::new)
                    .push(pattern);
            }
        }

        // Merge and consolidate patterns
        for (_, group) in extracted_patterns {
            if let Some(consolidated) = self.consolidate_pattern_group(&group) {
                self.add_or_update_pattern(consolidated).await?;
            }
        }

        tracing::info!("Learned patterns from {} episodes", episodes.len());
        Ok(())
    }

    fn extract_episode_patterns(&self, episode: &TaskEpisode) -> Vec<CodePattern> {
        let mut patterns = Vec::new();

        // Pattern: File co-access pattern
        if episode.files_touched.len() > 1 {
            patterns.push(CodePattern {
                id: format!("co_access_{}", uuid::Uuid::new_v4()),
                name: "File Co-Access Pattern".to_string(),
                description: format!("Files often modified together for: {}", episode.task_description),
                typical_actions: episode.files_touched.clone(),
                frequency: 1,
                success_rate: 1.0,
                context_markers: self.extract_markers(&episode.task_description),
            });
        }

        // Pattern: Query sequence pattern
        if episode.queries_made.len() > 1 {
            patterns.push(CodePattern {
                id: format!("query_seq_{}", uuid::Uuid::new_v4()),
                name: "Query Sequence Pattern".to_string(),
                description: "Common sequence of queries".to_string(),
                typical_actions: episode.queries_made.clone(),
                frequency: 1,
                success_rate: 1.0,
                context_markers: self.extract_markers(&episode.task_description),
            });
        }

        patterns
    }

    fn extract_markers(&self, text: &str) -> Vec<String> {
        text.split_whitespace()
            .filter(|w| w.len() > 3)
            .take(5)
            .map(|s| s.to_lowercase())
            .collect()
    }

    fn pattern_key(&self, pattern: &CodePattern) -> String {
        format!("{}:{}", pattern.name, pattern.context_markers.join("_"))
    }

    fn consolidate_pattern_group(&self, patterns: &[CodePattern]) -> Option<CodePattern> {
        if patterns.is_empty() {
            return None;
        }

        let mut consolidated = patterns[0].clone();
        consolidated.frequency = patterns.len() as u32;
        consolidated.success_rate = patterns.iter().map(|p| p.success_rate).sum::<f32>()
            / patterns.len() as f32;

        // Merge typical actions
        let mut all_actions = HashSet::new();
        for pattern in patterns {
            all_actions.extend(pattern.typical_actions.iter().cloned());
        }
        consolidated.typical_actions = all_actions.into_iter().collect();

        Some(consolidated)
    }

    async fn add_or_update_pattern(&mut self, pattern: CodePattern) -> Result<()> {
        // Check if similar pattern exists
        if let Some(existing_idx) = self
            .patterns
            .iter()
            .position(|p| self.patterns_are_similar(p, &pattern))
        {
            // Update existing pattern
            let existing = &mut self.patterns[existing_idx];
            existing.frequency += pattern.frequency;
            existing.success_rate = (existing.success_rate + pattern.success_rate) / 2.0;

            // Merge actions
            let mut actions: HashSet<_> = existing.typical_actions.iter().cloned().collect();
            actions.extend(pattern.typical_actions.iter().cloned());
            existing.typical_actions = actions.into_iter().collect();

            // Save updated pattern
            let key = format!("pattern:{}", existing.id);
            let value = serialize(existing)?;
            self.storage.put(key.as_bytes(), &value).await?;
        } else {
            // Add new pattern
            let key = format!("pattern:{}", pattern.id);
            let value = serialize(&pattern)?;
            self.storage.put(key.as_bytes(), &value).await?;
            self.patterns.push(pattern);
        }

        Ok(())
    }

    fn patterns_are_similar(&self, p1: &CodePattern, p2: &CodePattern) -> bool {
        if p1.name != p2.name {
            return false;
        }

        let markers1: HashSet<_> = p1.context_markers.iter().collect();
        let markers2: HashSet<_> = p2.context_markers.iter().collect();

        let intersection = markers1.intersection(&markers2).count();
        let union = markers1.union(&markers2).count();

        if union == 0 {
            return false;
        }

        (intersection as f32 / union as f32) > self.consolidation_threshold
    }

    /// Consolidate similar patterns
    pub async fn consolidate(&mut self) -> Result<()> {
        let mut to_merge: Vec<(usize, usize)> = Vec::new();

        // Find pairs to merge
        for i in 0..self.patterns.len() {
            for j in (i + 1)..self.patterns.len() {
                if self.patterns_are_similar(&self.patterns[i], &self.patterns[j]) {
                    to_merge.push((i, j));
                }
            }
        }

        // Merge patterns (in reverse order to maintain indices)
        for (i, j) in to_merge.iter().rev() {
            let pattern_j = self.patterns.remove(*j);
            let pattern_i = &mut self.patterns[*i];

            // Merge
            pattern_i.frequency += pattern_j.frequency;
            pattern_i.success_rate =
                (pattern_i.success_rate + pattern_j.success_rate) / 2.0;

            let mut actions: HashSet<_> = pattern_i.typical_actions.iter().cloned().collect();
            actions.extend(pattern_j.typical_actions.iter().cloned());
            pattern_i.typical_actions = actions.into_iter().collect();

            // Update storage
            let key = format!("pattern:{}", pattern_i.id);
            let value = serialize(pattern_i)?;
            self.storage.put(key.as_bytes(), &value).await?;

            // Delete merged pattern
            let key_j = format!("pattern:{}", pattern_j.id);
            self.storage.delete(key_j.as_bytes()).await?;
        }

        tracing::info!("Consolidated {} pattern pairs", to_merge.len());
        Ok(())
    }

    /// Add a relationship to the knowledge graph
    pub async fn add_relationship(&mut self, rel: SymbolRelationship) -> Result<()> {
        let key = format!("relationship:{}:{}", rel.from.0, rel.to.0);
        let value = serialize(&rel)?;
        self.storage.put(key.as_bytes(), &value).await?;

        self.knowledge_graph.add_relationship(rel);
        Ok(())
    }

    /// Find related symbols
    pub fn find_related_symbols(&self, symbol: &SymbolId) -> Vec<&SymbolRelationship> {
        self.knowledge_graph.get_related(symbol)
    }

    /// Find symbols that depend on this symbol
    pub fn find_dependents(&self, symbol: &SymbolId) -> Vec<&SymbolRelationship> {
        self.knowledge_graph.get_dependents(symbol)
    }

    /// Find connection path between two symbols
    pub fn find_connection_path(
        &self,
        from: &SymbolId,
        to: &SymbolId,
        max_depth: usize,
    ) -> Option<Vec<SymbolId>> {
        self.knowledge_graph.find_path(from, to, max_depth)
    }

    /// Get all patterns
    pub fn patterns(&self) -> &[CodePattern] {
        &self.patterns
    }

    /// Get all architectures
    pub fn architectures(&self) -> &[ArchitectureKnowledge] {
        &self.architectures
    }

    /// Get all conventions
    pub fn conventions(&self) -> &[CodingConvention] {
        &self.conventions
    }

    /// Find patterns matching context
    pub fn find_matching_patterns(&self, context_markers: &[String]) -> Vec<&CodePattern> {
        let markers_set: HashSet<_> = context_markers.iter().map(|s| s.as_str()).collect();

        self.patterns
            .iter()
            .filter(|p| {
                let pattern_markers: HashSet<_> =
                    p.context_markers.iter().map(|s| s.as_str()).collect();
                let intersection = markers_set.intersection(&pattern_markers).count();
                intersection > 0
            })
            .collect()
    }

    /// Add architecture knowledge
    pub async fn add_architecture(&mut self, arch: ArchitectureKnowledge) -> Result<()> {
        let key = format!("architecture:{}", uuid::Uuid::new_v4());
        let value = serialize(&arch)?;
        self.storage.put(key.as_bytes(), &value).await?;
        self.architectures.push(arch);
        Ok(())
    }

    /// Add coding convention
    pub async fn add_convention(&mut self, conv: CodingConvention) -> Result<()> {
        let key = format!("convention:{}", uuid::Uuid::new_v4());
        let value = serialize(&conv)?;
        self.storage.put(key.as_bytes(), &value).await?;
        self.conventions.push(conv);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::rocksdb_storage::RocksDBStorage;
    use crate::types::{EpisodeId, TokenCount};
    use chrono::Utc;
    use tempfile::TempDir;

    async fn create_test_storage() -> (Arc<dyn Storage>, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let storage = RocksDBStorage::new(temp_dir.path()).unwrap();
        (Arc::new(storage), temp_dir)
    }

    #[tokio::test]
    async fn test_learn_patterns() {
        let (storage, _temp) = create_test_storage().await;
        let mut memory = SemanticMemory::new(storage).unwrap();

        let episode = TaskEpisode {
            id: EpisodeId::new(),
            timestamp: Utc::now(),
            task_description: "Add authentication middleware".to_string(),
            initial_context: crate::types::ContextSnapshot::default(),
            queries_made: vec!["find auth".to_string(), "find middleware".to_string()],
            files_touched: vec!["auth.ts".to_string(), "middleware.ts".to_string()],
            solution_path: String::new(),
            outcome: Outcome::Success,
            tokens_used: TokenCount::zero(),
            access_count: 0,
            pattern_value: 0.9,
        };

        memory.learn_patterns(&[episode]).await.unwrap();
        assert!(!memory.patterns().is_empty());
    }

    #[tokio::test]
    async fn test_knowledge_graph() {
        let (storage, _temp) = create_test_storage().await;
        let mut memory = SemanticMemory::new(storage).unwrap();

        let from = SymbolId::new("ModuleA");
        let to = SymbolId::new("ModuleB");

        let rel = SymbolRelationship {
            from: from.clone(),
            to: to.clone(),
            relationship_type: RelationshipType::Imports,
            strength: 0.8,
            frequency: 5,
        };

        memory.add_relationship(rel).await.unwrap();

        let related = memory.find_related_symbols(&from);
        assert_eq!(related.len(), 1);
        assert_eq!(related[0].to.0, "ModuleB");
    }

    #[tokio::test]
    async fn test_find_connection_path() {
        let mut graph = KnowledgeGraph::new();

        let a = SymbolId::new("A");
        let b = SymbolId::new("B");
        let c = SymbolId::new("C");

        graph.add_relationship(SymbolRelationship {
            from: a.clone(),
            to: b.clone(),
            relationship_type: RelationshipType::Calls,
            strength: 1.0,
            frequency: 1,
        });

        graph.add_relationship(SymbolRelationship {
            from: b.clone(),
            to: c.clone(),
            relationship_type: RelationshipType::Calls,
            strength: 1.0,
            frequency: 1,
        });

        let path = graph.find_path(&a, &c, 10);
        assert!(path.is_some());
        assert_eq!(path.unwrap().len(), 3);
    }

    #[tokio::test]
    async fn test_consolidate_patterns() {
        let (storage, _temp) = create_test_storage().await;
        let mut memory = SemanticMemory::new(storage).unwrap();

        // Add similar patterns
        let pattern1 = CodePattern {
            id: "p1".to_string(),
            name: "Test Pattern".to_string(),
            description: "Test".to_string(),
            typical_actions: vec!["action1".to_string()],
            frequency: 1,
            success_rate: 0.9,
            context_markers: vec!["auth".to_string(), "middleware".to_string()],
        };

        let pattern2 = CodePattern {
            id: "p2".to_string(),
            name: "Test Pattern".to_string(),
            description: "Test".to_string(),
            typical_actions: vec!["action2".to_string()],
            frequency: 1,
            success_rate: 0.8,
            context_markers: vec!["auth".to_string(), "middleware".to_string()],
        };

        memory.add_or_update_pattern(pattern1).await.unwrap();
        memory.add_or_update_pattern(pattern2).await.unwrap();

        let count_before = memory.patterns().len();
        memory.consolidate().await.unwrap();
        let count_after = memory.patterns().len();

        assert!(count_after <= count_before);
    }

    #[tokio::test]
    async fn test_find_matching_patterns() {
        let (storage, _temp) = create_test_storage().await;
        let mut memory = SemanticMemory::new(storage).unwrap();

        let pattern = CodePattern {
            id: "test".to_string(),
            name: "Auth Pattern".to_string(),
            description: "Test".to_string(),
            typical_actions: vec![],
            frequency: 1,
            success_rate: 0.9,
            context_markers: vec!["auth".to_string(), "security".to_string()],
        };

        memory.add_or_update_pattern(pattern).await.unwrap();

        let matches = memory.find_matching_patterns(&["auth".to_string()]);
        assert_eq!(matches.len(), 1);
    }
}
