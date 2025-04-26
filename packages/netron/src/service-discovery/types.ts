export interface NodeInfo {
  nodeId: string;
  address: string;
  services: ServiceInfo[];
  timestamp: number;
}

export interface ServiceInfo {
  name: string;
  version?: string;
}

export interface DiscoveryOptions {
  heartbeatInterval?: number;    // Интервал отправки heartbeat (мс)
  heartbeatTTL?: number;         // TTL heartbeat-ключа (мс)
}
