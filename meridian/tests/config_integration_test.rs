use meridian::Config;
use std::env;
use tempfile::TempDir;

#[test]
fn test_global_config_initialization() {
    // Create a temporary directory to act as fake home
    let temp_home = TempDir::new().unwrap();
    let temp_meridian = temp_home.path().join(".meridian");
    std::fs::create_dir_all(&temp_meridian).unwrap();

    // Override HOME for this test
    let original_home = env::var("HOME").ok();
    env::set_var("HOME", temp_home.path());

    // Initialize global config
    let result = Config::init_global();
    assert!(result.is_ok());

    // Verify config file was created
    let config_path = temp_meridian.join("meridian.toml");
    assert!(config_path.exists());

    // Load config and verify it works
    let config = Config::load().unwrap();
    assert_eq!(config.session.max_sessions, 10);
    assert_eq!(config.learning.min_episodes_for_pattern, 3);

    // Verify storage path is global
    assert!(config.storage.path.to_string_lossy().contains(".meridian"));

    // Cleanup
    if let Some(home) = original_home {
        env::set_var("HOME", home);
    }
}

#[test]
fn test_env_variable_overrides() {
    // Set environment variables
    env::set_var("MERIDIAN_MCP_SOCKET", "/custom/path.sock");
    env::set_var("MERIDIAN_HTTP_PORT", "9000");
    env::set_var("MERIDIAN_MAX_TOKENS", "10000");

    // Create a config and apply overrides
    let mut config = Config::default();
    config.mcp.http = Some(meridian::config::HttpConfig::default());
    config.apply_env_overrides();

    // Verify overrides were applied
    assert_eq!(
        config.mcp.socket,
        Some(std::path::PathBuf::from("/custom/path.sock"))
    );
    if let Some(http) = config.mcp.http {
        assert_eq!(http.port, 9000);
    } else {
        panic!("HTTP config should be present");
    }
    assert_eq!(config.mcp.max_token_response, 10000);

    // Cleanup
    env::remove_var("MERIDIAN_MCP_SOCKET");
    env::remove_var("MERIDIAN_HTTP_PORT");
    env::remove_var("MERIDIAN_MAX_TOKENS");
}

#[test]
fn test_global_config_path_structure() {
    let path = Config::global_config_path();

    // Verify path structure
    assert!(path.to_string_lossy().contains(".meridian"));
    assert!(path.to_string_lossy().ends_with("meridian.toml"));

    // Verify it's an absolute path
    assert!(path.is_absolute());
}

#[test]
fn test_storage_config_uses_global_path() {
    let config = Config::default();

    // Verify storage path is global (in ~/.meridian)
    let path_str = config.storage.path.to_string_lossy();
    assert!(path_str.contains(".meridian"));
    assert!(path_str.contains("db/current/index"));
}

#[test]
fn test_monorepo_detection_config() {
    let config = Config::default();

    // Verify monorepo detection is enabled by default
    assert!(config.monorepo.detect_projects);

    // Verify common project markers are present
    let markers = &config.monorepo.project_markers;
    assert!(markers.contains(&"Cargo.toml".to_string()));
    assert!(markers.contains(&"package.json".to_string()));
    assert!(markers.contains(&"tsconfig.json".to_string()));
    assert!(markers.contains(&"go.mod".to_string()));
}

#[test]
fn test_config_save_and_load_roundtrip() {
    let temp_dir = TempDir::new().unwrap();
    let config_path = temp_dir.path().join("test_config.toml");

    // Create a config with custom values
    let mut config = Config::default();
    config.session.max_sessions = 25;
    config.learning.confidence_threshold = 0.85;
    config.memory.episodic_retention_days = 60;

    // Save to custom path
    config.save_to(&config_path).unwrap();
    assert!(config_path.exists());

    // Load from custom path
    let loaded = Config::from_file(&config_path).unwrap();

    // Verify all custom values were preserved
    assert_eq!(loaded.session.max_sessions, 25);
    assert_eq!(loaded.learning.confidence_threshold, 0.85);
    assert_eq!(loaded.memory.episodic_retention_days, 60);

    // Verify defaults for other fields
    assert_eq!(loaded.learning.min_episodes_for_pattern, 3);
}
