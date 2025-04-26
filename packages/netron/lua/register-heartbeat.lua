-- KEYS[1] - node key (hash)
-- KEYS[2] - heartbeat key (string)
-- KEYS[3] - nodes index set

-- ARGV[1] - node id
-- ARGV[2] - address
-- ARGV[3] - services (JSON)
-- ARGV[4] - timestamp
-- ARGV[5] - node TTL (seconds)
-- ARGV[6] - heartbeat TTL (milliseconds)

redis.call('HMSET', KEYS[1],
  'address', ARGV[2],
  'services', ARGV[3],
  'timestamp', ARGV[4]
)

redis.call('EXPIRE', KEYS[1], ARGV[5])
redis.call('PSETEX', KEYS[2], ARGV[6], '1')
redis.call('SADD', KEYS[3], ARGV[1])

return 1
