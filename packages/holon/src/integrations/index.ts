/**
 * External integrations
 *
 * Components for HTTP, gRPC, Kafka, and Redis integration
 */

export { HttpServer, createHttpServer, type HttpServerEvents, type ServerInfo } from './http.js';
export { GrpcServer, createGrpcServer, type GrpcServerConfig, type GrpcService } from './grpc.js';
export { KafkaClient, createKafkaClient } from './kafka.js';
export { RedisClient, createRedisClient } from './redis.js';
