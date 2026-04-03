-- KEYS[1]: patterns ZSET key
-- ARGV[1]: pattern
local count = redis.call("ZINCRBY", KEYS[1], -1, ARGV[1])
if tonumber(count) <= 0 then
  redis.call("ZREM", KEYS[1], ARGV[1])
  return 0
end
return count
