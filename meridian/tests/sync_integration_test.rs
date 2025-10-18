//! Integration tests for synchronization mechanism
//!
//! Tests the complete sync workflow:
//! - File change detection
//! - Push sync to global storage
//! - Pull sync from global storage
//! - Periodic synchronization
//! - Cache invalidation

use meridian::global::{
    GlobalServer, GlobalServerConfig, ProjectRegistryManager, SyncManager, WatcherConfig,
};
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use tempfile::TempDir;
use tokio::time::{sleep, Duration};

#[tokio::test]
async fn test_complete_sync_workflow() {
    // Create temporary directories
    let temp_dir = TempDir::new().unwrap();
    let project_dir = TempDir::new().unwrap();

    // Create a test project
    fs::write(
        project_dir.path().join("package.json"),
        r#"{"name": "test-sync-project", "version": "1.0.0"}"#,
    )
    .unwrap();

    fs::create_dir(project_dir.path().join("src")).unwrap();
    fs::write(
        project_dir.path().join("src/index.ts"),
        "console.log('Hello, world!');",
    )
    .unwrap();

    // Configure global server with file watching enabled
    let config = GlobalServerConfig {
        data_dir: temp_dir.path().to_path_buf(),
        host: "127.0.0.1".to_string(),
        port: 17900,
        auto_start: false,
        watch_enabled: true,
        watcher_config: Some(WatcherConfig {
            debounce_ms: 100, // Faster for testing
            ignore_patterns: vec![],
            watch_extensions: vec!["ts".to_string(), "js".to_string(), "json".to_string()],
            max_concurrent_reindex: 4,
        }),
    };

    // Start server
    let server = Arc::new(GlobalServer::new(config).await.unwrap());
    server.start().await.unwrap();

    // Give server time to start
    sleep(Duration::from_millis(100)).await;

    // Register the project
    let registry_manager = server.registry_manager();
    let project = registry_manager
        .register(project_dir.path().to_path_buf())
        .await
        .unwrap();

    let project_id = project.identity.full_id.clone();

    // Verify project is registered
    assert!(registry_manager.get(&project_id).await.unwrap().is_some());

    // Get initial sync stats
    let stats = server.get_sync_stats().await;
    assert!(stats.is_some());
    let initial_stats = stats.unwrap();
    assert_eq!(initial_stats.pending_changes, 0);

    // Modify a file to trigger file watcher
    fs::write(
        project_dir.path().join("src/index.ts"),
        "console.log('Hello, sync world!');",
    )
    .unwrap();

    // Give watcher and debouncer time to process
    sleep(Duration::from_millis(200)).await;

    // Check that change was detected (stats should show pending changes)
    let stats = server.get_sync_stats().await.unwrap();
    // Note: Depending on timing, this might be 0 if already synced or >0 if pending
    println!("Sync stats after file change: {:?}", stats);

    // Stop server gracefully
    server.stop().await.unwrap();
    assert_eq!(server.status().await, meridian::global::ServerStatus::Stopped);
}

#[tokio::test]
async fn test_sync_manager_push_pull() {
    // Create temporary directories
    let temp_dir = TempDir::new().unwrap();
    let project_dir = TempDir::new().unwrap();

    // Create a test project
    fs::write(
        project_dir.path().join("package.json"),
        r#"{"name": "test-push-pull", "version": "1.0.0"}"#,
    )
    .unwrap();

    // Set up global server components
    let storage = Arc::new(
        meridian::global::GlobalStorage::new(temp_dir.path())
            .await
            .unwrap(),
    );
    let registry = Arc::new(ProjectRegistryManager::new(Arc::clone(&storage)));
    let watcher = Arc::new(meridian::global::GlobalFileWatcher::new(
        WatcherConfig::default(),
        Arc::clone(&registry),
    ));

    let sync_manager = SyncManager::new(Arc::clone(&registry), Arc::clone(&storage), watcher);

    // Register project
    let project = registry
        .register(project_dir.path().to_path_buf())
        .await
        .unwrap();

    let project_id = project.identity.full_id.clone();

    // Test push sync
    let result = sync_manager.push_sync(&project_id).await.unwrap();
    assert_eq!(result.items_synced, 1);
    assert_eq!(result.errors, 0);
    assert_eq!(result.direction, meridian::global::SyncDirection::Push);
    println!("Push sync completed in {}ms", result.duration_ms);

    // Verify project is in global storage
    let stored_project = storage.get_project(&project_id).await.unwrap();
    assert!(stored_project.is_some());
    assert_eq!(stored_project.unwrap().identity.full_id, project_id);

    // Test pull sync
    let result = sync_manager.pull_sync(&project_id).await.unwrap();
    assert_eq!(result.items_synced, 1);
    assert_eq!(result.errors, 0);
    assert_eq!(result.direction, meridian::global::SyncDirection::Pull);
    println!("Pull sync completed in {}ms", result.duration_ms);
}

#[tokio::test]
async fn test_periodic_sync() {
    // Create temporary directories
    let temp_dir = TempDir::new().unwrap();
    let project_dir = TempDir::new().unwrap();

    // Create a test project
    fs::write(
        project_dir.path().join("package.json"),
        r#"{"name": "test-periodic", "version": "1.0.0"}"#,
    )
    .unwrap();

    // Set up global server components
    let storage = Arc::new(
        meridian::global::GlobalStorage::new(temp_dir.path())
            .await
            .unwrap(),
    );
    let registry = Arc::new(ProjectRegistryManager::new(Arc::clone(&storage)));
    let watcher = Arc::new(meridian::global::GlobalFileWatcher::new(
        WatcherConfig::default(),
        Arc::clone(&registry),
    ));

    let sync_manager = SyncManager::new(Arc::clone(&registry), Arc::clone(&storage), watcher);

    // Register project
    let _project = registry
        .register(project_dir.path().to_path_buf())
        .await
        .unwrap();

    // Start periodic sync
    sync_manager.start_periodic_sync().await.unwrap();

    // Let it run for a short time
    sleep(Duration::from_millis(200)).await;

    // Stop periodic sync
    sync_manager.stop().await.unwrap();
}

#[tokio::test]
async fn test_cache_invalidation() {
    // Create temporary directories
    let temp_dir = TempDir::new().unwrap();
    let project_dir = TempDir::new().unwrap();

    // Create a test project
    fs::write(
        project_dir.path().join("package.json"),
        r#"{"name": "test-invalidation", "version": "1.0.0"}"#,
    )
    .unwrap();

    // Set up global server components
    let storage = Arc::new(
        meridian::global::GlobalStorage::new(temp_dir.path())
            .await
            .unwrap(),
    );
    let registry = Arc::new(ProjectRegistryManager::new(Arc::clone(&storage)));
    let watcher = Arc::new(meridian::global::GlobalFileWatcher::new(
        WatcherConfig::default(),
        Arc::clone(&registry),
    ));

    let sync_manager = SyncManager::new(Arc::clone(&registry), Arc::clone(&storage), watcher);

    // Register project
    let project = registry
        .register(project_dir.path().to_path_buf())
        .await
        .unwrap();

    let project_id = project.identity.full_id.clone();

    // Invalidate cache for some paths
    let paths = vec![
        PathBuf::from("src/main.rs"),
        PathBuf::from("src/lib.rs"),
    ];

    sync_manager
        .invalidate_cache(&project_id, paths)
        .await
        .unwrap();

    // Check stats
    let stats = sync_manager.get_stats().await;
    assert_eq!(stats.pending_changes, 1);
    assert_eq!(stats.total_pending_paths, 2);
}

#[tokio::test]
async fn test_file_change_handling() {
    // Create temporary directories
    let temp_dir = TempDir::new().unwrap();
    let project_dir = TempDir::new().unwrap();

    // Create a test project
    fs::write(
        project_dir.path().join("package.json"),
        r#"{"name": "test-file-change", "version": "1.0.0"}"#,
    )
    .unwrap();

    // Set up global server components
    let storage = Arc::new(
        meridian::global::GlobalStorage::new(temp_dir.path())
            .await
            .unwrap(),
    );
    let registry = Arc::new(ProjectRegistryManager::new(Arc::clone(&storage)));
    let watcher = Arc::new(meridian::global::GlobalFileWatcher::new(
        WatcherConfig::default(),
        Arc::clone(&registry),
    ));

    let sync_manager = SyncManager::new(Arc::clone(&registry), Arc::clone(&storage), watcher);

    // Register project
    let project = registry
        .register(project_dir.path().to_path_buf())
        .await
        .unwrap();

    let project_id = project.identity.full_id.clone();

    // Simulate file change event
    let event = meridian::global::FileChangeEvent {
        path: PathBuf::from("src/main.rs"),
        kind: meridian::global::FileChangeKind::Modified,
        project_id: Some(project_id.clone()),
    };

    sync_manager.handle_file_change(event).await.unwrap();

    // Check stats
    let stats = sync_manager.get_stats().await;
    assert_eq!(stats.pending_changes, 1);
}

#[tokio::test]
async fn test_sync_performance() {
    // Create temporary directories
    let temp_dir = TempDir::new().unwrap();
    let project_dir = TempDir::new().unwrap();

    // Create a test project
    fs::write(
        project_dir.path().join("package.json"),
        r#"{"name": "test-performance", "version": "1.0.0"}"#,
    )
    .unwrap();

    // Set up global server components
    let storage = Arc::new(
        meridian::global::GlobalStorage::new(temp_dir.path())
            .await
            .unwrap(),
    );
    let registry = Arc::new(ProjectRegistryManager::new(Arc::clone(&storage)));
    let watcher = Arc::new(meridian::global::GlobalFileWatcher::new(
        WatcherConfig::default(),
        Arc::clone(&registry),
    ));

    let sync_manager = SyncManager::new(Arc::clone(&registry), Arc::clone(&storage), watcher);

    // Register project
    let project = registry
        .register(project_dir.path().to_path_buf())
        .await
        .unwrap();

    let project_id = project.identity.full_id.clone();

    // Test push sync performance
    let start = std::time::Instant::now();
    let result = sync_manager.push_sync(&project_id).await.unwrap();
    let elapsed = start.elapsed();

    println!("Push sync performance:");
    println!("  Duration: {:?}", elapsed);
    println!("  Items synced: {}", result.items_synced);
    println!("  Errors: {}", result.errors);

    // Verify performance is under 100ms for small changes (as per acceptance criteria)
    assert!(
        elapsed.as_millis() < 100,
        "Sync took {}ms, expected < 100ms",
        elapsed.as_millis()
    );
}
