/**
 * The address of infrastructure this daemon provisioned on this machine.
 *
 * Not `localhost`. That name resolves to two addresses — `::1` and
 * `127.0.0.1` — and Node tries them in the order the resolver returns, which
 * is IPv6 first here. Docker publishes a container's port on IPv4 only:
 *
 *     daos-dev-redis      127.0.0.1:6379->6379/tcp
 *     daos-dev-postgres   127.0.0.1:5432->5432/tcp
 *
 * so the first attempt of every new connection is refused and the client
 * reaches the service on the second. Measured, five connects each:
 *
 *     redis     localhost   0.91–3.76 ms      postgres  localhost   0.74–1.79 ms
 *     redis     127.0.0.1   0.35–0.75 ms      postgres  127.0.0.1   0.24–0.70 ms
 *     redis     ::1         ECONNREFUSED      postgres  ::1         ECONNREFUSED
 *
 * The milliseconds do not matter. The log does: about 3 500 ERROR records on
 * the dev stand, each an `AggregateError [ECONNREFUSED]` with an empty
 * `message` and `connect ECONNREFUSED ::1:6379` inside `aggregateErrors`,
 * every one of them followed by «connected successfully». A refusal that is
 * always followed by a success teaches an operator to read past refusals.
 *
 * A NODE's address is a different thing and stays a name: whatever the
 * operator wrote in `stackConfig.nodes[].host` is resolved as written.
 */
export const LOCAL_INFRA_HOST = '127.0.0.1';
