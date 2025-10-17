use crate::storage::{deserialize, serialize, Storage};
use crate::types::{Outcome, TaskEpisode};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

/// Procedural memory - knowledge about HOW to perform tasks
pub struct ProceduralMemory {
    storage: Arc<dyn Storage>,
    procedures: HashMap<TaskType, Procedure>,
    execution_history: Vec<ExecutionTrace>,
}

#[derive(Debug, Clone, Hash, PartialEq, Eq, Serialize, Deserialize)]
pub enum TaskType {
    Refactor,
    BugFix,
    Feature,
    Test,
    Documentation,
    Performance,
    Security,
    Other(String),
}

impl TaskType {
    /// Infer task type from description
    pub fn infer(description: &str) -> Self {
        let desc_lower = description.to_lowercase();

        if desc_lower.contains("refactor") || desc_lower.contains("restructure") {
            TaskType::Refactor
        } else if desc_lower.contains("bug") || desc_lower.contains("fix") || desc_lower.contains("error") {
            TaskType::BugFix
        } else if desc_lower.contains("test") {
            TaskType::Test
        } else if desc_lower.contains("document") || desc_lower.contains("readme") {
            TaskType::Documentation
        } else if desc_lower.contains("performance") || desc_lower.contains("optimize") {
            TaskType::Performance
        } else if desc_lower.contains("security") || desc_lower.contains("vulnerability") {
            TaskType::Security
        } else if desc_lower.contains("feature") || desc_lower.contains("add") || desc_lower.contains("implement") {
            TaskType::Feature
        } else {
            TaskType::Other(description.split_whitespace().take(3).collect::<Vec<_>>().join(" "))
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Procedure {
    pub steps: Vec<ProcedureStep>,
    pub required_context: Vec<String>,
    pub typical_queries: Vec<String>,
    pub success_rate: f32,
    pub execution_count: u32,
    pub average_tokens: u32,
    pub common_pitfalls: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcedureStep {
    pub order: usize,
    pub description: String,
    pub typical_actions: Vec<String>,
    pub expected_files: Vec<String>,
    pub optional: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionTrace {
    pub task_type: TaskType,
    pub episode_id: String,
    pub steps_taken: Vec<String>,
    pub outcome: Outcome,
    pub duration_estimate: u32, // in tokens
}

impl ProceduralMemory {
    pub fn new(storage: Arc<dyn Storage>) -> Result<Self> {
        Ok(Self {
            storage,
            procedures: HashMap::new(),
            execution_history: Vec::new(),
        })
    }

    /// Load procedures from storage
    pub async fn load(&mut self) -> Result<()> {
        let keys = self.storage.get_keys_with_prefix(b"procedure:").await?;

        for key in keys {
            if let Some(data) = self.storage.get(&key).await? {
                let (task_type, procedure): (TaskType, Procedure) = deserialize(&data)?;
                self.procedures.insert(task_type, procedure);
            }
        }

        // Load execution history
        let history_keys = self.storage.get_keys_with_prefix(b"execution:").await?;
        for key in history_keys {
            if let Some(data) = self.storage.get(&key).await? {
                let trace: ExecutionTrace = deserialize(&data)?;
                self.execution_history.push(trace);
            }
        }

        tracing::info!(
            "Loaded {} procedures and {} execution traces from storage",
            self.procedures.len(),
            self.execution_history.len()
        );
        Ok(())
    }

    /// Learn procedures from successful episodes
    pub async fn learn_from_episodes(&mut self, episodes: &[TaskEpisode]) -> Result<()> {
        // Group episodes by task type
        let mut grouped: HashMap<TaskType, Vec<&TaskEpisode>> = HashMap::new();

        for episode in episodes {
            let task_type = TaskType::infer(&episode.task_description);
            grouped.entry(task_type).or_insert_with(Vec::new).push(episode);
        }

        // Extract procedures from groups
        for (task_type, episodes) in grouped {
            if episodes.len() >= 2 {
                // Need at least 2 episodes to extract a pattern
                let procedure = self.extract_procedure(&episodes);
                self.add_or_update_procedure(task_type, procedure).await?;
            }
        }

        tracing::info!("Learned procedures from {} episodes", episodes.len());
        Ok(())
    }

    fn extract_procedure(&self, episodes: &[&TaskEpisode]) -> Procedure {
        let successful: Vec<_> = episodes
            .iter()
            .filter(|e| e.outcome == Outcome::Success)
            .collect();

        let success_rate = if episodes.is_empty() {
            0.0
        } else {
            successful.len() as f32 / episodes.len() as f32
        };

        // Extract common steps from solution paths
        let mut step_frequency: HashMap<String, usize> = HashMap::new();
        for episode in &successful {
            if !episode.solution_path.is_empty() {
                *step_frequency.entry(episode.solution_path.clone()).or_insert(0) += 1;
            }
        }

        // Convert to procedure steps
        let mut steps_vec: Vec<_> = step_frequency.into_iter().collect();
        steps_vec.sort_by(|a, b| b.1.cmp(&a.1)); // Sort by frequency

        let steps = steps_vec
            .into_iter()
            .enumerate()
            .map(|(i, (desc, freq))| ProcedureStep {
                order: i,
                description: desc.clone(),
                typical_actions: vec![desc],
                expected_files: vec![],
                optional: freq < successful.len() / 2, // Optional if not in majority
            })
            .collect();

        // Extract required context (files that appear in most episodes)
        let mut file_frequency: HashMap<String, usize> = HashMap::new();
        for episode in &successful {
            for file in &episode.files_touched {
                *file_frequency.entry(file.clone()).or_insert(0) += 1;
            }
        }

        let required_context: Vec<String> = file_frequency
            .into_iter()
            .filter(|(_, freq)| *freq >= successful.len() / 2)
            .map(|(file, _)| file)
            .collect();

        // Extract typical queries
        let mut query_frequency: HashMap<String, usize> = HashMap::new();
        for episode in &successful {
            for query in &episode.queries_made {
                *query_frequency.entry(query.clone()).or_insert(0) += 1;
            }
        }

        let typical_queries: Vec<String> = query_frequency
            .into_iter()
            .filter(|(_, freq)| *freq >= 2)
            .map(|(query, _)| query)
            .collect();

        // Calculate average tokens
        let total_tokens: u32 = episodes.iter().map(|e| e.tokens_used.0).sum();
        let average_tokens = if episodes.is_empty() {
            0
        } else {
            total_tokens / episodes.len() as u32
        };

        // Extract common pitfalls from failed episodes
        let failed: Vec<_> = episodes
            .iter()
            .filter(|e| e.outcome == Outcome::Failure)
            .collect();

        let mut pitfalls = Vec::new();
        for episode in failed {
            if !episode.solution_path.is_empty() {
                pitfalls.push(format!("Failed at: {}", episode.solution_path));
            }
        }

        Procedure {
            steps,
            required_context,
            typical_queries,
            success_rate,
            execution_count: episodes.len() as u32,
            average_tokens,
            common_pitfalls: pitfalls,
        }
    }

    async fn add_or_update_procedure(
        &mut self,
        task_type: TaskType,
        new_procedure: Procedure,
    ) -> Result<()> {
        if let Some(existing) = self.procedures.get_mut(&task_type) {
            // Update existing procedure
            existing.execution_count += new_procedure.execution_count;
            existing.success_rate = (existing.success_rate + new_procedure.success_rate) / 2.0;
            existing.average_tokens =
                (existing.average_tokens + new_procedure.average_tokens) / 2;

            // Merge steps
            let mut seen_steps = HashSet::new();
            for step in &existing.steps {
                seen_steps.insert(step.description.clone());
            }

            for new_step in new_procedure.steps {
                if !seen_steps.contains(&new_step.description) {
                    existing.steps.push(new_step);
                }
            }

            // Merge context and queries
            let mut context_set: HashSet<_> = existing.required_context.iter().cloned().collect();
            context_set.extend(new_procedure.required_context);
            existing.required_context = context_set.into_iter().collect();

            let mut query_set: HashSet<_> = existing.typical_queries.iter().cloned().collect();
            query_set.extend(new_procedure.typical_queries);
            existing.typical_queries = query_set.into_iter().collect();

            // Merge pitfalls
            existing.common_pitfalls.extend(new_procedure.common_pitfalls);
        } else {
            self.procedures.insert(task_type.clone(), new_procedure);
        }

        // Save to storage
        self.save_procedure(&task_type).await?;

        Ok(())
    }

    async fn save_procedure(&self, task_type: &TaskType) -> Result<()> {
        if let Some(procedure) = self.procedures.get(task_type) {
            let key = format!("procedure:{:?}", task_type);
            let value = serialize(&(task_type, procedure))?;
            self.storage.put(key.as_bytes(), &value).await?;
        }
        Ok(())
    }

    /// Learn a procedure manually
    pub async fn learn_procedure(
        &mut self,
        task_type: TaskType,
        procedure: Procedure,
    ) -> Result<()> {
        self.add_or_update_procedure(task_type, procedure).await
    }

    /// Get procedure for task type
    pub fn get_procedure(&self, task_type: &TaskType) -> Option<&Procedure> {
        self.procedures.get(task_type)
    }

    /// Get procedure by description (infers task type)
    pub fn get_procedure_for_task(&self, task_description: &str) -> Option<&Procedure> {
        let task_type = TaskType::infer(task_description);
        self.procedures.get(&task_type)
    }

    /// Get next suggested step
    pub fn next_step(
        &self,
        task_type: &TaskType,
        completed_steps: &[String],
    ) -> Option<&ProcedureStep> {
        let procedure = self.procedures.get(task_type)?;

        // Find first step not yet completed
        procedure.steps.iter().find(|step| {
            !completed_steps
                .iter()
                .any(|completed| step.description.contains(completed))
        })
    }

    /// Record execution trace
    pub async fn record_execution(&mut self, trace: ExecutionTrace) -> Result<()> {
        let key = format!("execution:{}", uuid::Uuid::new_v4());
        let value = serialize(&trace)?;
        self.storage.put(key.as_bytes(), &value).await?;
        self.execution_history.push(trace);
        Ok(())
    }

    /// Get execution history for task type
    pub fn get_execution_history(&self, task_type: &TaskType) -> Vec<&ExecutionTrace> {
        self.execution_history
            .iter()
            .filter(|trace| &trace.task_type == task_type)
            .collect()
    }

    /// Get all procedures
    pub fn procedures(&self) -> &HashMap<TaskType, Procedure> {
        &self.procedures
    }

    /// Get success rate for a task type
    pub fn get_success_rate(&self, task_type: &TaskType) -> Option<f32> {
        self.procedures.get(task_type).map(|p| p.success_rate)
    }

    /// Get estimated token cost for a task type
    pub fn get_estimated_cost(&self, task_type: &TaskType) -> Option<u32> {
        self.procedures.get(task_type).map(|p| p.average_tokens)
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

    #[test]
    fn test_task_type_inference() {
        assert_eq!(TaskType::infer("Fix authentication bug"), TaskType::BugFix);
        assert_eq!(TaskType::infer("Add new feature to API"), TaskType::Feature);
        assert_eq!(TaskType::infer("Refactor payment module"), TaskType::Refactor);
        assert_eq!(TaskType::infer("Write tests for service"), TaskType::Test);
        assert_eq!(TaskType::infer("Update documentation"), TaskType::Documentation);
    }

    #[tokio::test]
    async fn test_learn_from_episodes() {
        let (storage, _temp) = create_test_storage().await;
        let mut memory = ProceduralMemory::new(storage).unwrap();

        let episode1 = TaskEpisode {
            id: EpisodeId::new(),
            timestamp: Utc::now(),
            task_description: "Fix authentication bug".to_string(),
            initial_context: crate::types::ContextSnapshot::default(),
            queries_made: vec!["find auth".to_string()],
            files_touched: vec!["auth.ts".to_string()],
            solution_path: "Identified issue and fixed validation".to_string(),
            outcome: Outcome::Success,
            tokens_used: TokenCount::new(500),
            access_count: 0,
            pattern_value: 0.9,
        };

        let episode2 = TaskEpisode {
            id: EpisodeId::new(),
            timestamp: Utc::now(),
            task_description: "Fix login bug".to_string(),
            initial_context: crate::types::ContextSnapshot::default(),
            queries_made: vec!["find auth".to_string()],
            files_touched: vec!["auth.ts".to_string()],
            solution_path: "Identified issue and fixed validation".to_string(),
            outcome: Outcome::Success,
            tokens_used: TokenCount::new(450),
            access_count: 0,
            pattern_value: 0.8,
        };

        memory.learn_from_episodes(&[episode1, episode2]).await.unwrap();

        let procedure = memory.get_procedure(&TaskType::BugFix);
        assert!(procedure.is_some());
        let proc = procedure.unwrap();
        assert!(!proc.steps.is_empty());
        assert_eq!(proc.success_rate, 1.0);
    }

    #[tokio::test]
    async fn test_next_step() {
        let (storage, _temp) = create_test_storage().await;
        let mut memory = ProceduralMemory::new(storage).unwrap();

        let procedure = Procedure {
            steps: vec![
                ProcedureStep {
                    order: 0,
                    description: "Identify issue".to_string(),
                    typical_actions: vec![],
                    expected_files: vec![],
                    optional: false,
                },
                ProcedureStep {
                    order: 1,
                    description: "Fix validation".to_string(),
                    typical_actions: vec![],
                    expected_files: vec![],
                    optional: false,
                },
            ],
            required_context: vec![],
            typical_queries: vec![],
            success_rate: 1.0,
            execution_count: 1,
            average_tokens: 500,
            common_pitfalls: vec![],
        };

        memory
            .learn_procedure(TaskType::BugFix, procedure)
            .await
            .unwrap();

        let next = memory.next_step(&TaskType::BugFix, &[]);
        assert!(next.is_some());
        assert_eq!(next.unwrap().description, "Identify issue");

        let next2 = memory.next_step(&TaskType::BugFix, &["Identify issue".to_string()]);
        assert!(next2.is_some());
        assert_eq!(next2.unwrap().description, "Fix validation");
    }

    #[tokio::test]
    async fn test_execution_trace() {
        let (storage, _temp) = create_test_storage().await;
        let mut memory = ProceduralMemory::new(storage).unwrap();

        let trace = ExecutionTrace {
            task_type: TaskType::BugFix,
            episode_id: "test-123".to_string(),
            steps_taken: vec!["Step 1".to_string(), "Step 2".to_string()],
            outcome: Outcome::Success,
            duration_estimate: 500,
        };

        memory.record_execution(trace).await.unwrap();

        let history = memory.get_execution_history(&TaskType::BugFix);
        assert_eq!(history.len(), 1);
    }

    #[tokio::test]
    async fn test_get_procedure_for_task() {
        let (storage, _temp) = create_test_storage().await;
        let mut memory = ProceduralMemory::new(storage).unwrap();

        let procedure = Procedure {
            steps: vec![],
            required_context: vec![],
            typical_queries: vec![],
            success_rate: 0.9,
            execution_count: 5,
            average_tokens: 600,
            common_pitfalls: vec![],
        };

        memory
            .learn_procedure(TaskType::Feature, procedure)
            .await
            .unwrap();

        let proc = memory.get_procedure_for_task("Add new API endpoint");
        assert!(proc.is_some());
        assert_eq!(proc.unwrap().success_rate, 0.9);
    }

    #[tokio::test]
    async fn test_common_pitfalls() {
        let (storage, _temp) = create_test_storage().await;
        let memory = ProceduralMemory::new(storage).unwrap();

        let failed_episode = TaskEpisode {
            id: EpisodeId::new(),
            timestamp: Utc::now(),
            task_description: "Fix bug".to_string(),
            initial_context: crate::types::ContextSnapshot::default(),
            queries_made: vec![],
            files_touched: vec![],
            solution_path: "Tried approach A but failed at validation".to_string(),
            outcome: Outcome::Failure,
            tokens_used: TokenCount::new(300),
            access_count: 0,
            pattern_value: 0.0,
        };

        let procedure = memory.extract_procedure(&[&failed_episode]);
        assert!(!procedure.common_pitfalls.is_empty());
    }
}
