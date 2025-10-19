//! Handshake protocol for client-server negotiation
//!
//! The handshake protocol establishes the connection between thin clients and the
//! global RPC server, negotiating protocol version, capabilities, and session parameters.
//!
//! # Handshake Flow
//!
//! ```text
//! Client                                   Server
//!   |                                        |
//!   |  HandshakeRequest                      |
//!   |  - client_version                      |
//!   |  - protocol_version                    |
//!   |  - project_path                        |
//!   |  - capabilities                        |
//!   |--------------------------------------->|
//!   |                                        |
//!   |                  HandshakeResponse     |
//!   |                  - session_id          |
//!   |                  - server_version      |
//!   |                  - accepted_capabilities
//!   |                  - max_request_size    |
//!   |<---------------------------------------|
//!   |                                        |
//!   | (Connection established, begin RPC)    |
//!   |                                        |
//! ```

use super::protocol::{RpcError, ErrorCode};
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tracing::{debug, info, warn};
use uuid::Uuid;

/// Handshake request from client to server
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HandshakeRequest {
    /// Client version (e.g., "0.1.0")
    pub client_version: String,

    /// Protocol version the client supports
    pub protocol_version: u8,

    /// Client capabilities (e.g., "streaming", "compression")
    pub capabilities: Vec<String>,

    /// Client identifier (for logging/debugging)
    pub client_id: String,

    /// Project path (for context)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_path: Option<PathBuf>,

    /// Client metadata (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

impl HandshakeRequest {
    /// Create a new handshake request
    pub fn new(client_version: String, protocol_version: u8) -> Self {
        Self {
            client_version,
            protocol_version,
            capabilities: vec![],
            client_id: format!("client-{}", std::process::id()),
            project_path: None,
            metadata: None,
        }
    }

    /// Add a capability
    pub fn with_capability(mut self, capability: impl Into<String>) -> Self {
        self.capabilities.push(capability.into());
        self
    }

    /// Set project path
    pub fn with_project_path(mut self, path: PathBuf) -> Self {
        self.project_path = Some(path);
        self
    }

    /// Set client ID
    pub fn with_client_id(mut self, id: impl Into<String>) -> Self {
        self.client_id = id.into();
        self
    }

    /// Set metadata
    pub fn with_metadata(mut self, metadata: serde_json::Value) -> Self {
        self.metadata = Some(metadata);
        self
    }

    /// Validate the handshake request
    pub fn validate(&self) -> Result<(), RpcError> {
        if self.client_version.is_empty() {
            return Err(RpcError::invalid_request("Client version is required"));
        }

        if self.protocol_version == 0 {
            return Err(RpcError::invalid_request("Invalid protocol version"));
        }

        if self.client_id.is_empty() {
            return Err(RpcError::invalid_request("Client ID is required"));
        }

        Ok(())
    }
}

/// Handshake response from server to client
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HandshakeResponse {
    /// Server version
    pub server_version: String,

    /// Protocol version the server uses
    pub protocol_version: u8,

    /// Capabilities accepted by server
    pub capabilities: Vec<String>,

    /// Unique session ID for this connection
    pub session_id: String,

    /// Maximum request size (bytes)
    pub max_request_size: usize,

    /// Maximum response size (bytes)
    pub max_response_size: usize,

    /// Server metadata (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

impl HandshakeResponse {
    /// Create a new handshake response
    pub fn new(server_version: String, protocol_version: u8, session_id: String) -> Self {
        Self {
            server_version,
            protocol_version,
            capabilities: vec![],
            session_id,
            max_request_size: 10 * 1024 * 1024,  // 10MB
            max_response_size: 100 * 1024 * 1024, // 100MB
            metadata: None,
        }
    }

    /// Add an accepted capability
    pub fn with_capability(mut self, capability: impl Into<String>) -> Self {
        self.capabilities.push(capability.into());
        self
    }

    /// Set max request size
    pub fn with_max_request_size(mut self, size: usize) -> Self {
        self.max_request_size = size;
        self
    }

    /// Set max response size
    pub fn with_max_response_size(mut self, size: usize) -> Self {
        self.max_response_size = size;
        self
    }

    /// Set metadata
    pub fn with_metadata(mut self, metadata: serde_json::Value) -> Self {
        self.metadata = Some(metadata);
        self
    }
}

/// Handshake manager for server-side negotiation
pub struct HandshakeManager {
    server_version: String,
    protocol_version: u8,
    supported_capabilities: Vec<String>,
}

impl HandshakeManager {
    /// Create a new handshake manager
    pub fn new(server_version: String, protocol_version: u8) -> Self {
        Self {
            server_version,
            protocol_version,
            supported_capabilities: vec![
                "streaming".to_string(),
                "compression".to_string(),
                "lz4".to_string(),
                "zstd".to_string(),
            ],
        }
    }

    /// Add a supported capability
    pub fn add_capability(&mut self, capability: impl Into<String>) {
        self.supported_capabilities.push(capability.into());
    }

    /// Process a handshake request and generate response
    pub fn process_handshake(&self, request: HandshakeRequest) -> Result<HandshakeResponse> {
        info!(
            "Processing handshake from client {} (version: {}, protocol: {})",
            request.client_id, request.client_version, request.protocol_version
        );

        // Validate request
        request.validate()
            .map_err(|e| anyhow::anyhow!("Invalid handshake request: {}", e))?;

        // Check protocol version compatibility
        if request.protocol_version != self.protocol_version {
            warn!(
                "Protocol version mismatch: client={}, server={}",
                request.protocol_version, self.protocol_version
            );
            bail!(
                "Protocol version mismatch: client uses v{}, server uses v{}",
                request.protocol_version,
                self.protocol_version
            );
        }

        // Negotiate capabilities (intersection of client and server capabilities)
        let accepted_capabilities: Vec<String> = request
            .capabilities
            .iter()
            .filter(|cap| self.supported_capabilities.contains(cap))
            .cloned()
            .collect();

        debug!(
            "Accepted capabilities: {:?} (client requested: {:?})",
            accepted_capabilities, request.capabilities
        );

        // Generate session ID
        let session_id = Uuid::new_v4().to_string();

        // Build response
        let mut response = HandshakeResponse::new(
            self.server_version.clone(),
            self.protocol_version,
            session_id.clone(),
        );

        // Add accepted capabilities
        for cap in accepted_capabilities {
            response = response.with_capability(cap);
        }

        // Add server metadata
        let metadata = serde_json::json!({
            "project_path": request.project_path,
            "timestamp": chrono::Utc::now().to_rfc3339(),
        });
        response = response.with_metadata(metadata);

        info!("Handshake successful, session ID: {}", session_id);

        Ok(response)
    }

    /// Check if a capability is supported
    pub fn supports_capability(&self, capability: &str) -> bool {
        self.supported_capabilities.contains(&capability.to_string())
    }
}

/// Handshake client helper for thin clients
pub struct HandshakeClient {
    client_version: String,
    protocol_version: u8,
    capabilities: Vec<String>,
}

impl HandshakeClient {
    /// Create a new handshake client
    pub fn new(client_version: String, protocol_version: u8) -> Self {
        Self {
            client_version,
            protocol_version,
            capabilities: vec![
                "streaming".to_string(),
                "compression".to_string(),
            ],
        }
    }

    /// Add a capability to request
    pub fn add_capability(&mut self, capability: impl Into<String>) {
        self.capabilities.push(capability.into());
    }

    /// Create a handshake request
    pub fn create_request(&self, project_path: Option<PathBuf>) -> HandshakeRequest {
        let mut request = HandshakeRequest::new(
            self.client_version.clone(),
            self.protocol_version,
        );

        // Add capabilities
        for cap in &self.capabilities {
            request = request.with_capability(cap.clone());
        }

        // Add project path if provided
        if let Some(path) = project_path {
            request = request.with_project_path(path);
        }

        // Add metadata
        let metadata = serde_json::json!({
            "platform": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "pid": std::process::id(),
        });
        request = request.with_metadata(metadata);

        request
    }

    /// Validate a handshake response
    pub fn validate_response(&self, response: &HandshakeResponse) -> Result<()> {
        // Check protocol version
        if response.protocol_version != self.protocol_version {
            bail!(
                "Protocol version mismatch: expected {}, got {}",
                self.protocol_version,
                response.protocol_version
            );
        }

        // Check session ID is present
        if response.session_id.is_empty() {
            bail!("Server did not provide a session ID");
        }

        info!(
            "Handshake validated: session_id={}, capabilities={:?}",
            response.session_id, response.capabilities
        );

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_handshake_request_creation() {
        let request = HandshakeRequest::new("0.1.0".to_string(), 1)
            .with_capability("streaming")
            .with_capability("compression")
            .with_project_path(PathBuf::from("/tmp/test"));

        assert_eq!(request.client_version, "0.1.0");
        assert_eq!(request.protocol_version, 1);
        assert_eq!(request.capabilities.len(), 2);
        assert!(request.project_path.is_some());
    }

    #[test]
    fn test_handshake_request_validation() {
        let valid = HandshakeRequest::new("0.1.0".to_string(), 1);
        assert!(valid.validate().is_ok());

        let invalid = HandshakeRequest::new("".to_string(), 1);
        assert!(invalid.validate().is_err());
    }

    #[test]
    fn test_handshake_manager() {
        let manager = HandshakeManager::new("0.1.0".to_string(), 1);

        let request = HandshakeRequest::new("0.1.0".to_string(), 1)
            .with_capability("streaming")
            .with_capability("unsupported");

        let response = manager.process_handshake(request).unwrap();

        assert_eq!(response.protocol_version, 1);
        assert!(!response.session_id.is_empty());
        assert!(response.capabilities.contains(&"streaming".to_string()));
        assert!(!response.capabilities.contains(&"unsupported".to_string()));
    }

    #[test]
    fn test_protocol_version_mismatch() {
        let manager = HandshakeManager::new("0.1.0".to_string(), 1);

        let request = HandshakeRequest::new("0.1.0".to_string(), 2);

        let result = manager.process_handshake(request);
        assert!(result.is_err());
    }

    #[test]
    fn test_handshake_client() {
        let client = HandshakeClient::new("0.1.0".to_string(), 1);
        let request = client.create_request(Some(PathBuf::from("/tmp/test")));

        assert_eq!(request.client_version, "0.1.0");
        assert_eq!(request.protocol_version, 1);
        assert!(request.capabilities.contains(&"streaming".to_string()));
    }
}
