-- KEYS[1]: Stream key
-- KEYS[2]: Sorted Set key for delayed messages
-- ARGV[1]: Consumer Group
-- ARGV[2]: Channel name
-- ARGV[3]: Payload
-- ARGV[4]: Original Timestamp
-- ARGV[5]: Current Attempt (number)
-- ARGV[6]: Delay timestamp (retry delay)
-- ARGV[7]: Message ID

local streamKey = KEYS[1]
local delayedSetKey = KEYS[2]
local consumerGroup = ARGV[1]
local messageId = ARGV[2]
local channel = ARGV[3]
local payload = ARGV[4]
local originalTimestamp = ARGV[5]
local attempt = tonumber(ARGV[6]) + 1
local delayTimestamp = tonumber(ARGV[7])
local messageUUID = ARGV[8]

redis.call("ZADD", delayedSetKey, delayTimestamp, messageUUID)

local delayedMessage = cjson.encode({
  channel = channel,
  payload = payload,
  timestamp = originalTimestamp,
  attempt = tostring(attempt)
})

redis.call("SET", "rotif:delayed:" .. messageUUID, delayedMessage)

redis.call("XACK", streamKey, consumerGroup, messageId)

return "RETRIED"