use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Get the Meridian home directory (~/.meridian)
pub fn get_meridian_home() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".meridian")
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
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
            path: get_meridian_home().join("db").join("current").join("index"),
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
    pub http: Option<HttpConfig>,
}

impl Default for McpConfig {
    fn default() -> Self {
        Self {
            socket: Some(PathBuf::from("/tmp/meridian.sock")),
            max_token_response: 2000,
            http: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpConfig {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub cors_origins: Vec<String>,
    pub max_connections: usize,
}

impl Default for HttpConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            host: "127.0.0.1".to_string(),
            port: 3000,
            cors_origins: vec!["*".to_string()],
            max_connections: 100,
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_default_config() {
        let config = Config::default();
        assert_eq!(config.index.languages.len(), 4);
        assert!(config.index.languages.contains(&"rust".to_string()));
        assert_eq!(config.session.max_sessions, 10);
        assert_eq!(config.learning.min_episodes_for_pattern, 3);
    }

    #[test]
    fn test_index_config_default() {
        let config = IndexConfig::default();
        assert_eq!(config.max_file_size, "1MB");
        assert!(config.ignore.contains(&"node_modules".to_string()));
        assert!(config.ignore.contains(&"target".to_string()));
    }

    #[test]
    fn test_storage_config_default() {
        let config = StorageConfig::default();
        // Verify path ends with db/current/index
        assert!(config.path.ends_with("db/current/index"));
        // Verify path contains .meridian
        assert!(config.path.to_string_lossy().contains(".meridian"));
        assert_eq!(config.cache_size, "256MB");
    }

    #[test]
    fn test_memory_config_default() {
        let config = MemoryConfig::default();
        assert_eq!(config.episodic_retention_days, 30);
        assert_eq!(config.working_memory_size, "10MB");
        assert_eq!(config.consolidation_interval, "1h");
    }

    #[test]
    fn test_session_config_default() {
        let config = SessionConfig::default();
        assert_eq!(config.max_sessions, 10);
        assert_eq!(config.session_timeout, "1h");
    }

    #[test]
    fn test_monorepo_config_default() {
        let config = MonorepoConfig::default();
        assert!(config.detect_projects);
        assert_eq!(config.project_markers.len(), 4);
        assert!(config.project_markers.contains(&"package.json".to_string()));
    }

    #[test]
    fn test_learning_config_default() {
        let config = LearningConfig::default();
        assert_eq!(config.min_episodes_for_pattern, 3);
        assert_eq!(config.confidence_threshold, 0.7);
    }

    #[test]
    fn test_mcp_config_default() {
        let config = McpConfig::default();
        assert_eq!(config.max_token_response, 2000);
        assert!(config.socket.is_some());
    }

    #[test]
    fn test_http_config_default() {
        let config = HttpConfig::default();
        assert!(config.enabled);
        assert_eq!(config.host, "127.0.0.1");
        assert_eq!(config.port, 3000);
        assert_eq!(config.max_connections, 100);
    }

    #[test]
    fn test_save_and_load_config() {
        let temp_dir = TempDir::new().unwrap();
        let config_path = temp_dir.path().join("config.toml");

        let mut config = Config::default();
        config.session.max_sessions = 20;
        config.learning.confidence_threshold = 0.8;

        config.save(&config_path).unwrap();
        assert!(config_path.exists());

        let loaded = Config::from_file(&config_path).unwrap();
        assert_eq!(loaded.session.max_sessions, 20);
        assert_eq!(loaded.learning.confidence_threshold, 0.8);
    }

    #[test]
    fn test_load_nonexistent_file() {
        let temp_dir = TempDir::new().unwrap();
        let config_path = temp_dir.path().join("nonexistent.toml");

        let config = Config::from_file(&config_path).unwrap();
        // Should return default config
        assert_eq!(config.session.max_sessions, 10);
    }

    #[test]
    fn test_load_invalid_toml() {
        let temp_dir = TempDir::new().unwrap();
        let config_path = temp_dir.path().join("invalid.toml");
        std::fs::write(&config_path, "invalid toml {{{}").unwrap();

        let result = Config::from_file(&config_path);
        assert!(result.is_err());
    }

    #[test]
    fn test_config_serialization() {
        let config = Config::default();
        let toml_str = toml::to_string(&config).unwrap();
        assert!(toml_str.contains("[index]"));
        assert!(toml_str.contains("[storage]"));
        assert!(toml_str.contains("[memory]"));
        assert!(toml_str.contains("[session]"));
    }

    #[test]
    fn test_config_round_trip() {
        let temp_dir = TempDir::new().unwrap();
        let config_path = temp_dir.path().join("roundtrip.toml");

        // Create a default config, modify some values
        let mut config = Config::default();
        config.session.max_sessions = 5;
        config.session.session_timeout = "2h".to_string();
        config.learning.confidence_threshold = 0.85;

        // Save and reload
        config.save(&config_path).unwrap();
        let loaded = Config::from_file(&config_path).unwrap();

        assert_eq!(loaded.session.max_sessions, 5);
        assert_eq!(loaded.session.session_timeout, "2h");
        assert_eq!(loaded.learning.confidence_threshold, 0.85);
        // Other fields should match defaults
        assert_eq!(loaded.learning.min_episodes_for_pattern, 3);
    }
}
