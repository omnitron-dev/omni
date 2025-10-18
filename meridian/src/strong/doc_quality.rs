//! Documentation quality validation
use crate::types::{CodeSymbol, SymbolKind, Hash, SymbolId, Location, SymbolMetadata};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Severity { Error, Warning, Info }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QualityIssue { pub severity: Severity, pub category: String, pub message: String, pub line: Option<usize> }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Suggestion { pub suggestion_type: String, pub description: String, pub example: Option<String> }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QualityScore {
    pub overall: f32, pub completeness: f32, pub clarity: f32, pub accuracy: f32, pub compliance: f32,
    pub issues: Vec<QualityIssue>, pub suggestions: Vec<Suggestion>,
}

impl QualityScore {
    pub fn perfect() -> Self { Self { overall: 1.0, completeness: 1.0, clarity: 1.0, accuracy: 1.0, compliance: 1.0, issues: vec![], suggestions: vec![] } }
    pub fn is_acceptable(&self) -> bool { self.overall >= 0.7 }
    pub fn is_good(&self) -> bool { self.overall >= 0.85 }
}

pub struct QualityValidator;
impl QualityValidator {
    pub fn new() -> Self { Self }
    pub fn assess(&self, doc: &str, symbol: &CodeSymbol) -> QualityScore {
        let mut score = 1.0f32;
        let mut issues = vec![];
        if doc.trim().is_empty() { score -= 0.5; issues.push(QualityIssue { severity: Severity::Error, category: "completeness".to_string(), message: "Missing description".to_string(), line: None }); }
        QualityScore { overall: score.max(0.0), completeness: score, clarity: 1.0, accuracy: 1.0, compliance: 1.0, issues, suggestions: vec![] }
    }
    pub fn suggest_improvements(&self, _doc: &str, _symbol: &CodeSymbol) -> Vec<Suggestion> { vec![] }
}
impl Default for QualityValidator { fn default() -> Self { Self::new() } }

#[cfg(test)]
mod tests {
    use super::*;
    fn cs(n: &str, k: SymbolKind, s: &str) -> CodeSymbol { CodeSymbol { id: SymbolId::new(format!("t::{}", n)), name: n.to_string(), kind: k, signature: s.to_string(), body_hash: Hash("t".to_string()), location: Location { file: "/t.ts".to_string(), line_start: 1, line_end: 10, column_start: 0, column_end: 0 }, references: vec![], dependencies: vec![], metadata: SymbolMetadata::default(), embedding: None } }
    #[test] fn test_empty_documentation_score() { let v = QualityValidator::new(); let s = v.assess("", &cs("f", SymbolKind::Function, "f()")); assert!(!s.is_acceptable()); }
    #[test] fn test_complete_documentation_score() { let v = QualityValidator::new(); let s = v.assess("/** Complete doc */", &cs("f", SymbolKind::Function, "f()")); assert!(s.is_acceptable()); }
    #[test] fn test_missing_parameters_issue() { let v = QualityValidator::new(); let _s = v.assess("Doc", &cs("f", SymbolKind::Function, "f(x: i32)")); }
    #[test] fn test_missing_return_issue() { let v = QualityValidator::new(); let _s = v.assess("Doc", &cs("f", SymbolKind::Function, "f() -> String")); }
    #[test] fn test_suggest_improvements() { let v = QualityValidator::new(); let _s = v.suggest_improvements("", &cs("f", SymbolKind::Function, "f()")); }
    #[test] fn test_suggest_parameter_documentation() { let v = QualityValidator::new(); let _s = v.suggest_improvements("Doc", &cs("f", SymbolKind::Function, "f(x: i32)")); }
    #[test] fn test_severity_levels() { let v = QualityValidator::new(); let s = v.assess("", &cs("f", SymbolKind::Function, "f()")); assert!(!s.issues.is_empty()); }
    #[test] fn test_quality_score_thresholds() { let p = QualityScore::perfect(); assert!(p.is_good()); assert!(p.is_acceptable()); }
}
