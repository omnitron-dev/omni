pub mod episodic;
pub mod procedural;
pub mod semantic;
pub mod working;

use crate::config::MemoryConfig;
use crate::storage::Storage;
use anyhow::Result;
use std::sync::Arc;

pub use episodic::EpisodicMemory;
pub use procedural::ProceduralMemory;
pub use semantic::SemanticMemory;
pub use working::WorkingMemory;

/// Complete memory system
pub struct MemorySystem {
    pub episodic: EpisodicMemory,
    pub working: WorkingMemory,
    pub semantic: SemanticMemory,
    pub procedural: ProceduralMemory,
}

impl MemorySystem {
    pub fn new(storage: Arc<dyn Storage>, config: MemoryConfig) -> Result<Self> {
        Ok(Self {
            episodic: EpisodicMemory::new(storage.clone(), config.episodic_retention_days)?,
            working: WorkingMemory::new(config.working_memory_size)?,
            semantic: SemanticMemory::new(storage.clone())?,
            procedural: ProceduralMemory::new(storage.clone())?,
        })
    }

    /// Initialize the memory system
    pub async fn init(&mut self) -> Result<()> {
        // Load existing data from storage
        self.episodic.load().await?;
        self.semantic.load().await?;
        self.procedural.load().await?;
        Ok(())
    }

    /// Periodic consolidation
    pub async fn consolidate(&mut self) -> Result<()> {
        self.episodic.consolidate().await?;
        self.semantic.consolidate().await?;
        Ok(())
    }
}
