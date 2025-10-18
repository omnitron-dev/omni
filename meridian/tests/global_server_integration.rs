//! Integration tests for global server functionality
//!
//! Tests the complete global server architecture including:
//! - Project registry management
//! - Global server daemon lifecycle
//! - IPC communication
//! - File watching
//! - Cross-monorepo features

use meridian::global::{
    GlobalServer, GlobalServerConfig, ProjectRegistryManager, GlobalStorage,
    WatcherConfig,
};
use std::sync::Arc;
use tempfile::TempDir;
use tokio::time::{sleep, Duration};

/// Test basic global server lifecycle
#[tokio::test]
async fn test_global_server_lifecycle() {
    let temp_dir = TempDir::new().unwrap();

    let config = GlobalServerConfig {
        data_dir: temp_dir.path().to_path_buf(),
        host: "127.0.0.1".to_string(),
        port: 18878, // Different port to avoid conflicts
        auto_start: false,
        watch_enabled: false, // Disable file watching for this test
        watcher_config: None,
    };

    let server = GlobalServer::new(config).await.unwrap();

    // Server should start as stopped
    assert_eq!(
        server.status().await,
        meridian::global::ServerStatus::Stopped
    );

    // Start the server
    server.start().await.unwrap();

    // Give IPC server time to start
    sleep(Duration::from_millis(100)).await;

    assert_eq!(
        server.status().await,
        meridian::global::ServerStatus::Running
    );

    // Stop the server
    server.stop().await.unwrap();

    assert_eq!(
        server.status().await,
        meridian::global::ServerStatus::Stopped
    );
}

/// Test project registration and retrieval
#[tokio::test]
async fn test_project_registry() {
    let temp_dir = TempDir::new().unwrap();

    // Create a test project
    let project_dir = TempDir::new().unwrap();
    std::fs::write(
        project_dir.path().join("package.json"),
        r#"{"name": "test-project", "version": "1.0.0"}"#,
    )
    .unwrap();

    let storage = Arc::new(GlobalStorage::new(temp_dir.path()).await.unwrap());
    let manager = Arc::new(ProjectRegistryManager::new(storage));

    // Register the project
    let registry = manager
        .register(project_dir.path().to_path_buf())
        .await
        .unwrap();

    assert_eq!(registry.identity.id, "test-project");
    assert_eq!(registry.identity.version, "1.0.0");

    // Retrieve the project
    let retrieved = manager
        .get(&registry.identity.full_id)
        .await
        .unwrap()
        .unwrap();

    assert_eq!(retrieved.identity.id, "test-project");
    assert_eq!(retrieved.current_path, project_dir.path());

    // List all projects
    let all_projects = manager.list_all().await.unwrap();
    assert_eq!(all_projects.len(), 1);
}

/// Test project relocation
#[tokio::test]
async fn test_project_relocation() {
    let temp_dir = TempDir::new().unwrap();

    // Create initial project
    let project_dir1 = TempDir::new().unwrap();
    std::fs::write(
        project_dir1.path().join("package.json"),
        r#"{"name": "relocatable-project", "version": "1.0.0"}"#,
    )
    .unwrap();

    let storage = Arc::new(GlobalStorage::new(temp_dir.path()).await.unwrap());
    let manager = Arc::new(ProjectRegistryManager::new(storage));

    // Register the project
    let registry = manager
        .register(project_dir1.path().to_path_buf())
        .await
        .unwrap();

    let project_id = registry.identity.full_id.clone();

    // Create new location
    let project_dir2 = TempDir::new().unwrap();

    // Relocate
    manager
        .relocate_project(&project_id, project_dir2.path().to_path_buf(), "test-relocation".to_string())
        .await
        .unwrap();

    // Verify relocation
    let relocated = manager.get(&project_id).await.unwrap().unwrap();

    assert_eq!(relocated.current_path, project_dir2.path());
    assert_eq!(relocated.path_history.len(), 2);
    assert_eq!(relocated.path_history[1].reason, "test-relocation");
}

/// Test file watcher
#[tokio::test]
async fn test_file_watcher_basic() {
    let temp_dir = TempDir::new().unwrap();

    // Create a test project
    let project_dir = TempDir::new().unwrap();
    std::fs::write(
        project_dir.path().join("package.json"),
        r#"{"name": "watched-project", "version": "1.0.0"}"#,
    )
    .unwrap();

    let storage = Arc::new(GlobalStorage::new(temp_dir.path()).await.unwrap());
    let manager = Arc::new(ProjectRegistryManager::new(storage));

    // Register the project
    let registry = manager
        .register(project_dir.path().to_path_buf())
        .await
        .unwrap();

    // Create watcher
    let watcher_config = WatcherConfig {
        debounce_ms: 100,
        ..Default::default()
    };

    let watcher = meridian::global::GlobalFileWatcher::new(
        watcher_config,
        Arc::clone(&manager),
    );

    // Start watching
    watcher.start().await.unwrap();

    // Add the project to watcher
    watcher.add_project(&registry).await.unwrap();

    // Get stats
    let stats = watcher.get_stats().await;
    assert_eq!(stats.watched_projects, 1);

    // Stop watcher
    watcher.stop().await.unwrap();
}

/// Test global server with file watching enabled
#[tokio::test]
async fn test_global_server_with_watcher() {
    let temp_dir = TempDir::new().unwrap();

    let config = GlobalServerConfig {
        data_dir: temp_dir.path().to_path_buf(),
        host: "127.0.0.1".to_string(),
        port: 18879,
        auto_start: false,
        watch_enabled: true,
        watcher_config: Some(WatcherConfig {
            debounce_ms: 100,
            ..Default::default()
        }),
    };

    let server = GlobalServer::new(config).await.unwrap();

    // Start the server
    server.start().await.unwrap();

    // Give systems time to initialize
    sleep(Duration::from_millis(200)).await;

    // Check watcher stats
    let watcher_stats = server.get_watcher_stats().await;
    assert!(watcher_stats.is_some());

    // Stop the server
    server.stop().await.unwrap();
}

/// Test multiple projects in registry
#[tokio::test]
async fn test_multiple_projects() {
    let temp_dir = TempDir::new().unwrap();

    let storage = Arc::new(GlobalStorage::new(temp_dir.path()).await.unwrap());
    let manager = Arc::new(ProjectRegistryManager::new(storage));

    // Create and register multiple projects
    for i in 1..=5 {
        let project_dir = TempDir::new().unwrap();
        std::fs::write(
            project_dir.path().join("package.json"),
            format!(r#"{{"name": "project-{}", "version": "1.0.0"}}"#, i),
        )
        .unwrap();

        manager
            .register(project_dir.path().to_path_buf())
            .await
            .unwrap();

        // Keep directory alive for the test
        std::mem::forget(project_dir);
    }

    // List all projects
    let all_projects = manager.list_all().await.unwrap();
    assert_eq!(all_projects.len(), 5);

    // Search by name
    let search_results = manager.find_by_name("project-3").await.unwrap();
    assert_eq!(search_results.len(), 1);
    assert_eq!(search_results[0].identity.id, "project-3");
}

/// Test current project management
#[tokio::test]
async fn test_current_project() {
    let temp_dir = TempDir::new().unwrap();

    let project_dir = TempDir::new().unwrap();
    std::fs::write(
        project_dir.path().join("package.json"),
        r#"{"name": "current-project", "version": "1.0.0"}"#,
    )
    .unwrap();

    let storage = Arc::new(GlobalStorage::new(temp_dir.path()).await.unwrap());
    let manager = Arc::new(ProjectRegistryManager::new(storage));

    // Register project
    let registry = manager
        .register(project_dir.path().to_path_buf())
        .await
        .unwrap();

    // No current project initially
    assert!(manager.get_current_project().await.unwrap().is_none());

    // Set current project
    manager
        .set_current_project(&registry.identity.full_id)
        .await
        .unwrap();

    // Verify current project
    let current = manager.get_current_project().await.unwrap();
    assert!(current.is_some());
    assert_eq!(current.unwrap(), registry.identity.full_id);

    // Get current project registry
    let current_registry = manager
        .get_current_project_registry()
        .await
        .unwrap()
        .unwrap();

    assert_eq!(current_registry.identity.id, "current-project");
}
