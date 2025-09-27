/**
 * API Client for Orchestron Web Panel
 * Replaces Tauri API calls with HTTP/WebSocket connections
 */

export interface SessionData {
  id: string;
  path: string;
  createdAt: Date;
  modifiedAt: Date;
  metadata?: any;
}

export interface AgentData {
  id: string;
  name: string;
  config: any;
  status: 'active' | 'inactive';
}

export interface HookData {
  id: string;
  name: string;
  type: string;
  script: string;
  enabled: boolean;
}

class ApiClient {
  private baseUrl: string;
  private wsUrl: string;
  private ws: WebSocket | null = null;

  constructor() {
    // Use environment variables or defaults
    this.baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
    this.wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:3002';
  }

  // HTTP Methods
  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }

    return response.json();
  }

  // Session Management
  async getSessions(): Promise<SessionData[]> {
    return this.request<SessionData[]>('/sessions');
  }

  async getSession(id: string): Promise<SessionData> {
    return this.request<SessionData>(`/sessions/${id}`);
  }

  async createSession(data: Partial<SessionData>): Promise<SessionData> {
    return this.request<SessionData>('/sessions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateSession(id: string, data: Partial<SessionData>): Promise<SessionData> {
    return this.request<SessionData>(`/sessions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteSession(id: string): Promise<void> {
    return this.request<void>(`/sessions/${id}`, {
      method: 'DELETE',
    });
  }

  // Agent Management
  async getAgents(): Promise<AgentData[]> {
    return this.request<AgentData[]>('/agents');
  }

  async getAgent(id: string): Promise<AgentData> {
    return this.request<AgentData>(`/agents/${id}`);
  }

  async createAgent(data: Partial<AgentData>): Promise<AgentData> {
    return this.request<AgentData>('/agents', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateAgent(id: string, data: Partial<AgentData>): Promise<AgentData> {
    return this.request<AgentData>(`/agents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteAgent(id: string): Promise<void> {
    return this.request<void>(`/agents/${id}`, {
      method: 'DELETE',
    });
  }

  // Hook Management
  async getHooks(): Promise<HookData[]> {
    return this.request<HookData[]>('/hooks');
  }

  async getHook(id: string): Promise<HookData> {
    return this.request<HookData>(`/hooks/${id}`);
  }

  async createHook(data: Partial<HookData>): Promise<HookData> {
    return this.request<HookData>('/hooks', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateHook(id: string, data: Partial<HookData>): Promise<HookData> {
    return this.request<HookData>(`/hooks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteHook(id: string): Promise<void> {
    return this.request<void>(`/hooks/${id}`, {
      method: 'DELETE',
    });
  }

  // File Operations (replacing Tauri file dialog)
  async selectFile(options?: { filters?: string[] }): Promise<string | null> {
    // This would open a file picker dialog through the API
    return this.request<string | null>('/files/select', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  async readFile(path: string): Promise<string> {
    return this.request<string>('/files/read', {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
  }

  async writeFile(path: string, content: string): Promise<void> {
    return this.request<void>('/files/write', {
      method: 'POST',
      body: JSON.stringify({ path, content }),
    });
  }

  async listDirectory(path: string): Promise<string[]> {
    return this.request<string[]>('/files/list', {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
  }

  // WebSocket Connection for real-time updates
  connectWebSocket(onMessage: (data: any) => void, onError?: (error: Error) => void): void {
    if (this.ws) {
      this.ws.close();
    }

    this.ws = new WebSocket(this.wsUrl);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessage(data);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      if (onError) {
        onError(new Error('WebSocket connection error'));
      }
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
      // Attempt to reconnect after 5 seconds
      setTimeout(() => {
        if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
          this.connectWebSocket(onMessage, onError);
        }
      }, 5000);
    };
  }

  disconnectWebSocket(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  sendWebSocketMessage(message: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket is not connected');
    }
  }

  // Shell command execution (replacing Tauri shell)
  async executeCommand(command: string, args?: string[]): Promise<{ stdout: string; stderr: string }> {
    return this.request<{ stdout: string; stderr: string }>('/shell/execute', {
      method: 'POST',
      body: JSON.stringify({ command, args }),
    });
  }

  // System info
  async getSystemInfo(): Promise<any> {
    return this.request<any>('/system/info');
  }

  // Open external URL (replacing Tauri opener)
  async openExternal(url: string): Promise<void> {
    return this.request<void>('/system/open', {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
  }
}

// Export singleton instance
export const apiClient = new ApiClient();

// Export for testing
export default ApiClient;