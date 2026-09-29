/**
 * The gateway's own Redis database — where the maintenance lock lives.
 *
 * Three sides name it, and each used to compute it its own way:
 *
 *   the gateway on a node     `(redis.db ?? 0) + 1`            → 1
 *   main's GATEWAY_REDIS_URL   `redisDbOffset + 5`              → 5
 *   the gateway on a dev stack `portAllocation.redisDbEnd + 1`  → 5
 *
 * Measured on daos/test on 2026-09-29: main wrote the maintenance key to DB 5
 * and the gateway read DB 1, so the mode an administrator switched on never
 * engaged — and both numbers belonged to somebody else: storage's database
 * is 1 and geo's is 5, on the node and on dev alike. `REDIS_DB_RANGE_SIZE`
 * (5) was the width of a project with five databases; daos has eight.
 *
 * One rule now, used by every side that names the database and by the
 * deployer that sets the lock: the number the stack declares for `gateway`
 * in `infrastructure.redis.databases`, or else the last of Redis's sixteen
 * default databases — a number no side needs the apps' allocation to know,
 * which is the point: the gateway is created before that allocation is
 * computed, on the node and on dev both. The allocator reserves it, so no
 * app is ever handed it.
 */

/** The key a stack uses to state the gateway's database explicitly. */
export const GATEWAY_REDIS_DB_KEY = 'gateway';

/** Redis's default `databases 16` makes 15 the last index. */
export const DEFAULT_GATEWAY_REDIS_DB = 15;

export function gatewayRedisDb(declared?: Readonly<Record<string, number>> | undefined): number {
  const stated = declared?.[GATEWAY_REDIS_DB_KEY];
  return typeof stated === 'number' && Number.isInteger(stated) && stated >= 0 ? stated : DEFAULT_GATEWAY_REDIS_DB;
}
