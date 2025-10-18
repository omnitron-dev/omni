// Concrete migration implementations

pub mod task_v1_to_v2;

pub use task_v1_to_v2::TaskV1ToV2Migration;

use super::migration::MigrationRegistry;

/// Initialize all migrations in the registry
pub fn register_all_migrations(registry: &mut MigrationRegistry) {
    // Register Task migrations
    registry.register(Box::new(TaskV1ToV2Migration));
}
