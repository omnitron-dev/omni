// Security vulnerability scanning module

pub mod patterns;
pub mod scanner;
pub mod secrets;
pub mod types;

pub use scanner::SecurityScanner;
pub use types::{
    SecurityFinding, SecurityLevel, VulnerabilityCategory, VulnerabilityType, ScanResult,
    ScanOptions, SecretPattern,
};
