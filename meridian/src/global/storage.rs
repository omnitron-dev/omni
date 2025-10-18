//! Global RocksDB storage wrapper
//!
//! Implements the global storage schema as defined in global-architecture-spec.md.
//! This is the global database that stores all projects across all monorepos.

use super::registry::ProjectRegistry;
use anyhow::{Context, Result};
use rocksdb::{Options, DB};
use std::path::Path;
use std::sync::Arc;

/// Global storage using RocksDB
///
/// Schema (as per global-architecture-spec.md):
/// ```
/// registry:projects:{fullId}                    → ProjectRegistry (JSON)
/// registry:index:name:{projectName}             → fullId[]
/// registry:index:monorepo:{monorepoId}          → fullId[]
/// registry:index:path:{pathHash}                → fullId
/// ```
pub struct GlobalStorage {
    db: Arc<DB>,
}

impl GlobalStorage {
    /// Create a new global storage
    pub async fn new(path: &Path) -> Result<Self> {
        let mut opts = Options::default();
        opts.create_if_missing(true);
        opts.create_missing_column_families(true);

        let db = DB::open(&opts, path)
            .with_context(|| format!("Failed to open global database at {:?}", path))?;

        Ok(Self { db: Arc::new(db) })
    }

    /// Put a project into the registry
    pub async fn put_project(&self, registry: &ProjectRegistry) -> Result<()> {
        let key = format!("registry:projects:{}", registry.identity.full_id);
        let value = serde_json::to_vec(registry)
            .with_context(|| "Failed to serialize project registry")?;

        self.db
            .put(&key, &value)
            .with_context(|| format!("Failed to store project {}", registry.identity.full_id))?;

        // Update indexes
        self.update_indexes(registry).await?;

        Ok(())
    }

    /// Get a project by its full ID
    pub async fn get_project(&self, full_id: &str) -> Result<Option<ProjectRegistry>> {
        let key = format!("registry:projects:{}", full_id);

        match self.db.get(&key)? {
            Some(value) => {
                let registry: ProjectRegistry = serde_json::from_slice(&value)
                    .with_context(|| format!("Failed to deserialize project {}", full_id))?;
                Ok(Some(registry))
            }
            None => Ok(None),
        }
    }

    /// Find project by path
    pub async fn find_project_by_path(&self, path: &Path) -> Result<Option<ProjectRegistry>> {
        let path_hash = Self::hash_path(path);
        let key = format!("registry:index:path:{}", path_hash);

        match self.db.get(&key)? {
            Some(value) => {
                let full_id = String::from_utf8(value)
                    .with_context(|| "Failed to parse path index")?;
                self.get_project(&full_id).await
            }
            None => Ok(None),
        }
    }

    /// List all projects
    pub async fn list_all_projects(&self) -> Result<Vec<ProjectRegistry>> {
        let prefix = "registry:projects:";
        let mut projects = Vec::new();

        let iter = self.db.prefix_iterator(prefix.as_bytes());
        for item in iter {
            let (key, value) = item?;

            // Verify this is a project key
            if let Ok(key_str) = std::str::from_utf8(&key) {
                if key_str.starts_with(prefix) {
                    if let Ok(registry) = serde_json::from_slice::<ProjectRegistry>(&value) {
                        projects.push(registry);
                    }
                }
            }
        }

        Ok(projects)
    }

    /// Update all indexes for a project
    async fn update_indexes(&self, registry: &ProjectRegistry) -> Result<()> {
        // Name index
        let name_key = format!("registry:index:name:{}", registry.identity.id);
        self.db.put(&name_key, registry.identity.full_id.as_bytes())?;

        // Path index
        let path_hash = Self::hash_path(&registry.current_path);
        let path_key = format!("registry:index:path:{}", path_hash);
        self.db.put(&path_key, registry.identity.full_id.as_bytes())?;

        // Monorepo index (if applicable)
        if let Some(ref monorepo) = registry.monorepo {
            let monorepo_key = format!("registry:index:monorepo:{}", monorepo.id);

            // Get existing full_ids for this monorepo
            let mut full_ids: Vec<String> = match self.db.get(&monorepo_key)? {
                Some(value) => serde_json::from_slice(&value).unwrap_or_default(),
                None => Vec::new(),
            };

            // Add this project if not already there
            if !full_ids.contains(&registry.identity.full_id) {
                full_ids.push(registry.identity.full_id.clone());
                let value = serde_json::to_vec(&full_ids)?;
                self.db.put(&monorepo_key, &value)?;
            }
        }

        Ok(())
    }

    /// Hash a path for indexing
    fn hash_path(path: &Path) -> String {
        let path_str = path.display().to_string();
        let hash = blake3::hash(path_str.as_bytes());
        hash.to_hex().to_string()
    }

    /// Get the underlying database (for advanced operations)
    pub fn db(&self) -> Arc<DB> {
        Arc::clone(&self.db)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::global::identity::ProjectIdentity;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_put_and_get_project() {
        let temp_dir = TempDir::new().unwrap();
        let storage = GlobalStorage::new(temp_dir.path()).await.unwrap();

        let project_dir = TempDir::new().unwrap();
        std::fs::write(
            project_dir.path().join("package.json"),
            r#"{"name": "test", "version": "1.0.0"}"#,
        )
        .unwrap();

        let identity = ProjectIdentity::from_npm(project_dir.path()).unwrap();
        let registry = ProjectRegistry::new(identity.clone(), project_dir.path().to_path_buf());

        storage.put_project(&registry).await.unwrap();

        let retrieved = storage.get_project(&identity.full_id).await.unwrap();
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().identity.id, "test");
    }

    #[tokio::test]
    async fn test_find_by_path() {
        let temp_dir = TempDir::new().unwrap();
        let storage = GlobalStorage::new(temp_dir.path()).await.unwrap();

        let project_dir = TempDir::new().unwrap();
        std::fs::write(
            project_dir.path().join("package.json"),
            r#"{"name": "test-path", "version": "1.0.0"}"#,
        )
        .unwrap();

        let identity = ProjectIdentity::from_npm(project_dir.path()).unwrap();
        let registry = ProjectRegistry::new(identity, project_dir.path().to_path_buf());

        storage.put_project(&registry).await.unwrap();

        let found = storage
            .find_project_by_path(project_dir.path())
            .await
            .unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().identity.id, "test-path");
    }

    #[tokio::test]
    async fn test_list_all_projects() {
        let temp_dir = TempDir::new().unwrap();
        let storage = GlobalStorage::new(temp_dir.path()).await.unwrap();

        // Create two projects
        let project1 = TempDir::new().unwrap();
        std::fs::write(
            project1.path().join("package.json"),
            r#"{"name": "project1", "version": "1.0.0"}"#,
        )
        .unwrap();

        let project2 = TempDir::new().unwrap();
        std::fs::write(
            project2.path().join("package.json"),
            r#"{"name": "project2", "version": "1.0.0"}"#,
        )
        .unwrap();

        let identity1 = ProjectIdentity::from_npm(project1.path()).unwrap();
        let registry1 = ProjectRegistry::new(identity1, project1.path().to_path_buf());

        let identity2 = ProjectIdentity::from_npm(project2.path()).unwrap();
        let registry2 = ProjectRegistry::new(identity2, project2.path().to_path_buf());

        storage.put_project(&registry1).await.unwrap();
        storage.put_project(&registry2).await.unwrap();

        let all = storage.list_all_projects().await.unwrap();
        assert_eq!(all.len(), 2);
    }

    #[tokio::test]
    async fn test_path_hash_stability() {
        let path = Path::new("/some/test/path");
        let hash1 = GlobalStorage::hash_path(path);
        let hash2 = GlobalStorage::hash_path(path);
        assert_eq!(hash1, hash2);
    }

    #[tokio::test]
    async fn test_update_after_insert() {
        let temp_dir = TempDir::new().unwrap();
        let storage = GlobalStorage::new(temp_dir.path()).await.unwrap();

        let project_dir = TempDir::new().unwrap();
        std::fs::write(
            project_dir.path().join("package.json"),
            r#"{"name": "test-update", "version": "1.0.0"}"#,
        )
        .unwrap();

        let identity = ProjectIdentity::from_npm(project_dir.path()).unwrap();
        let mut registry = ProjectRegistry::new(identity.clone(), project_dir.path().to_path_buf());

        storage.put_project(&registry).await.unwrap();

        // Update the registry
        let new_path = TempDir::new().unwrap();
        registry.relocate(new_path.path().to_path_buf(), "test".to_string());
        storage.put_project(&registry).await.unwrap();

        let updated = storage.get_project(&identity.full_id).await.unwrap().unwrap();
        assert_eq!(updated.path_history.len(), 2);
    }
}
