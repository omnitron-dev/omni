//! Strong Tools - Documentation Generation and Knowledge Management
//!
//! This module implements the documentation generation and knowledge management
//! features as specified in strong-tools-spec.md.

pub mod doc_generator;
pub mod doc_quality;
pub mod templates;
pub mod catalog;
pub mod cross_ref;
pub mod example_generator;
pub mod test_generator;
pub mod example_validator;
pub mod cross_monorepo;

pub use doc_generator::{DocumentationGenerator, GeneratedDoc, DocFormat, DocTransformOptions};
pub use doc_quality::{QualityValidator, QualityScore, QualityIssue, Suggestion};
pub use templates::{TemplateEngine, DocTemplate};
pub use catalog::{GlobalCatalog, ProjectMetadata, SearchScope, DocResult};
pub use cross_ref::{CrossReferenceManager, CrossReference, ReferenceType, DependencyGraph};
pub use example_generator::{ExampleGenerator, Example, ExampleComplexity, ValidationResult};
pub use test_generator::{TestGenerator, GeneratedTest, TestFramework, TestType};
pub use example_validator::ExampleValidator;
pub use cross_monorepo::{CrossMonorepoAccess, ExternalDocs, Usage, UsageType, AccessControl, SearchResult, MatchType};
