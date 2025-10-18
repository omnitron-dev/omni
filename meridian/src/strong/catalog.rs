//! Global documentation catalog
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectMetadata { pub id: String, pub name: String, pub path: PathBuf, pub symbol_count: usize, pub coverage: f32, pub dependencies: Vec<String>, pub description: Option<String> }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SearchScope { Local, Dependencies, Global }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocResult { pub project_id: String, pub symbol_name: String, pub content: String, pub file_path: String, pub relevance: f32 }

pub struct GlobalCatalog { projects: HashMap<String, ProjectMetadata>, docs: HashMap<String, HashMap<String, String>> }
impl GlobalCatalog {
    pub fn new() -> Self { Self { projects: HashMap::new(), docs: HashMap::new() } }
    pub fn index_project(&mut self, m: ProjectMetadata) -> Result<()> { let id = m.id.clone(); self.projects.insert(id.clone(), m); self.docs.entry(id).or_insert_with(HashMap::new); Ok(()) }
    pub fn get_project(&self, id: &str) -> Option<&ProjectMetadata> { self.projects.get(id) }
    pub fn get_project_by_name(&self, n: &str) -> Option<&ProjectMetadata> { self.projects.values().find(|p| p.name == n) }
    pub fn get_project_by_path(&self, p: &PathBuf) -> Option<&ProjectMetadata> { self.projects.values().find(|m| &m.path == p) }
    pub fn list_projects(&self) -> Vec<&ProjectMetadata> { self.projects.values().collect() }
    pub fn add_documentation(&mut self, pid: &str, sym: &str, content: &str) -> Result<()> { self.docs.entry(pid.to_string()).or_insert_with(HashMap::new).insert(sym.to_string(), content.to_string()); Ok(()) }
    pub fn get_documentation(&self, pid: &str, sym: &str) -> Option<&String> { self.docs.get(pid).and_then(|d| d.get(sym)) }
    pub fn search(&self, _q: &str, _scope: SearchScope, _cur: Option<&str>) -> Result<Vec<DocResult>> { Ok(vec![]) }
    pub fn get_project_docs(&self, pid: &str) -> Option<&HashMap<String, String>> { self.docs.get(pid) }
    pub fn remove_project(&mut self, pid: &str) -> Result<()> { self.projects.remove(pid); self.docs.remove(pid); Ok(()) }
    pub fn update_project(&mut self, m: ProjectMetadata) -> Result<()> { self.projects.insert(m.id.clone(), m); Ok(()) }
}
impl Default for GlobalCatalog { fn default() -> Self { Self::new() } }

#[cfg(test)]
mod tests {
    use super::*;
    fn pm(id: &str, n: &str, p: &str) -> ProjectMetadata { ProjectMetadata { id: id.to_string(), name: n.to_string(), path: PathBuf::from(p), symbol_count: 0, coverage: 0.0, dependencies: vec![], description: None } }
    #[test] fn test_index_project() { let mut c = GlobalCatalog::new(); c.index_project(pm("p1", "proj", "/p")).unwrap(); assert!(c.get_project("p1").is_some()); }
    #[test] fn test_get_project_by_name() { let mut c = GlobalCatalog::new(); c.index_project(pm("p1", "proj", "/p")).unwrap(); assert!(c.get_project_by_name("proj").is_some()); }
    #[test] fn test_get_project_by_path() { let mut c = GlobalCatalog::new(); c.index_project(pm("p1", "proj", "/p")).unwrap(); assert!(c.get_project_by_path(&PathBuf::from("/p")).is_some()); }
    #[test] fn test_add_and_get_documentation() { let mut c = GlobalCatalog::new(); c.index_project(pm("p1", "proj", "/p")).unwrap(); c.add_documentation("p1", "f", "doc").unwrap(); assert!(c.get_documentation("p1", "f").is_some()); }
    #[test] fn test_search_local_scope() { let mut c = GlobalCatalog::new(); c.index_project(pm("p1", "proj", "/p")).unwrap(); let _r = c.search("q", SearchScope::Local, Some("p1")).unwrap(); }
    #[test] fn test_search_global_scope() { let mut c = GlobalCatalog::new(); c.index_project(pm("p1", "proj", "/p")).unwrap(); let _r = c.search("q", SearchScope::Global, None).unwrap(); }
    #[test] fn test_remove_project() { let mut c = GlobalCatalog::new(); c.index_project(pm("p1", "proj", "/p")).unwrap(); c.remove_project("p1").unwrap(); assert!(c.get_project("p1").is_none()); }
    #[test] fn test_update_project() { let mut c = GlobalCatalog::new(); c.index_project(pm("p1", "proj", "/p")).unwrap(); let mut m = pm("p1", "proj", "/p"); m.symbol_count = 100; c.update_project(m).unwrap(); assert_eq!(c.get_project("p1").unwrap().symbol_count, 100); }
}
