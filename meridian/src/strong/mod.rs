//! Strong Tools - Documentation Generation and Knowledge Management
//!
//! This module implements the documentation generation and knowledge management
//! features as specified in strong-tools-spec.md.

pub mod doc_generator;
pub mod doc_quality;
pub mod templates;
pub mod catalog;
pub mod cross_ref;

pub use doc_generator::{DocumentationGenerator, GeneratedDoc, DocFormat, DocTransformOptions};
pub use doc_quality::{QualityValidator, QualityScore, QualityIssue, Suggestion};
pub use templates::{TemplateEngine, DocTemplate};
pub use catalog::{GlobalCatalog, ProjectMetadata, SearchScope, DocResult};
pub use cross_ref::{CrossReferenceManager, CrossReference, ReferenceType, DependencyGraph};
