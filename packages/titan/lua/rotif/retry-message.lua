-- KEYS[1]: Current stream key (to ACK from)
-- KEYS[2]: Sorted Set key for delayed messages
-- ARGV[1]: Consumer Group
-- ARGV[2]: Message ID to ACK
-- ARGV[3]: Channel name
-- ARGV[4]: Payload
-- ARGV[5]: Original Timestamp
-- ARGV[6]: Next Attempt (number)
-- ARGV[7]: Delay timestamp (retry delay)
-- ARGV[8]: New Message UUID
-- ARGV[9]: exactlyOnce flag
-- ARGV[10]: dedupTTL
-- ARGV[11]: Retry stream key (where retry will be sent)
-- ARGV[12]: Pattern (for deduplication consistency)

local currentStreamKey = KEYS[1]
local delayedSetKey = KEYS[2]

local consumerGroup = ARGV[1]
local messageId = ARGV[2]
local channel = ARGV[3]
local payload = ARGV[4]
local originalTimestamp = ARGV[5]
local attempt = ARGV[6]
local delayTimestamp = tonumber(ARGV[7])
local messageUUID = ARGV[8]
local exactlyOnce = ARGV[9]
local dedupTTL = ARGV[10]
local retryStreamKey = ARGV[11]
local pattern = ARGV[12]

redis.call("ZADD", delayedSetKey, delayTimestamp, messageUUID)

local delayedMessage = cjson.encode({
  streamKey = retryStreamKey,
  channel = channel,
  payload = payload,
  timestamp = originalTimestamp,
  attempt = attempt,
  exactlyOnce = exactlyOnce,
  dedupTTL = dedupTTL,
  pattern = pattern
})

redis.call("SET", "rotif:delayed:" .. messageUUID, delayedMessage)

redis.call("XACK", currentStreamKey, consumerGroup, messageId)

return "RETRIED"