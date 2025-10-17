use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub index: IndexConfig,
    pub storage: StorageConfig,
    pub memory: MemoryConfig,
    pub session: SessionConfig,
    pub monorepo: MonorepoConfig,
    pub learning: LearningConfig,
    pub mcp: McpConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexConfig {
    pub languages: Vec<String>,
    pub ignore: Vec<String>,
    pub max_file_size: String,
}

impl Default for IndexConfig {
    fn default() -> Self {
        Self {
            languages: vec![
                "rust".to_string(),
                "typescript".to_string(),
                "javascript".to_string(),
                "markdown".to_string(),
            ],
            ignore: vec![
                "node_modules".to_string(),
                "target".to_string(),
                ".git".to_string(),
                "dist".to_string(),
                "build".to_string(),
            ],
            max_file_size: "1MB".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageConfig {
    pub path: PathBuf,
    pub cache_size: String,
}

impl Default for StorageConfig {
    fn default() -> Self {
        Self {
            path: PathBuf::from(".meridian/index"),
            cache_size: "256MB".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryConfig {
    pub episodic_retention_days: u32,
    pub working_memory_size: String,
    pub consolidation_interval: String,
}

impl Default for MemoryConfig {
    fn default() -> Self {
        Self {
            episodic_retention_days: 30,
            working_memory_size: "10MB".to_string(),
            consolidation_interval: "1h".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionConfig {
    pub max_sessions: usize,
    pub session_timeout: String,
}

impl Default for SessionConfig {
    fn default() -> Self {
        Self {
            max_sessions: 10,
            session_timeout: "1h".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonorepoConfig {
    pub detect_projects: bool,
    pub project_markers: Vec<String>,
}

impl Default for MonorepoConfig {
    fn default() -> Self {
        Self {
            detect_projects: true,
            project_markers: vec![
                "Cargo.toml".to_string(),
                "package.json".to_string(),
                "tsconfig.json".to_string(),
                "go.mod".to_string(),
            ],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LearningConfig {
    pub min_episodes_for_pattern: u32,
    pub confidence_threshold: f32,
}

impl Default for LearningConfig {
    fn default() -> Self {
        Self {
            min_episodes_for_pattern: 3,
            confidence_threshold: 0.7,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpConfig {
    pub socket: Option<PathBuf>,
    pub max_token_response: u32,
}

impl Default for McpConfig {
    fn default() -> Self {
        Self {
            socket: Some(PathBuf::from("/tmp/meridian.sock")),
            max_token_response: 2000,
        }
    }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            index: IndexConfig::default(),
            storage: StorageConfig::default(),
            memory: MemoryConfig::default(),
            session: SessionConfig::default(),
            monorepo: MonorepoConfig::default(),
            learning: LearningConfig::default(),
            mcp: McpConfig::default(),
        }
    }
}

impl Config {
    pub fn from_file(path: &Path) -> Result<Self> {
        if !path.exists() {
            tracing::warn!("Config file not found at {:?}, using defaults", path);
            return Ok(Self::default());
        }

        let contents = std::fs::read_to_string(path)
            .with_context(|| format!("Failed to read config file: {:?}", path))?;

        let config: Config = toml::from_str(&contents)
            .with_context(|| format!("Failed to parse config file: {:?}", path))?;

        Ok(config)
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        let contents = toml::to_string_pretty(self)
            .context("Failed to serialize config")?;

        std::fs::write(path, contents)
            .with_context(|| format!("Failed to write config file: {:?}", path))?;

        Ok(())
    }
}
