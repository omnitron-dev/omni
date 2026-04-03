-- KEYS[1]: delayed set key (rotif:scheduled)
-- ARGV[1]: current timestamp
-- ARGV[2]: max number of messages to process

local delayedSetKey = KEYS[1]
local now = tonumber(ARGV[1])
local batchSize = tonumber(ARGV[2])

local messageIds = redis.call("ZRANGEBYSCORE", delayedSetKey, "-inf", now, "LIMIT", 0, batchSize)
local count = 0

for _, messageId in ipairs(messageIds) do
  local payloadKey = "rotif:delayed:" .. messageId
  local delayedPayloadJson = redis.call("GET", payloadKey)

  if delayedPayloadJson then
    local delayedPayload = cjson.decode(delayedPayloadJson)
    local channel = delayedPayload.channel
    local streamKey = delayedPayload.streamKey or ("rotif:stream:" .. channel)

    redis.call("XADD", streamKey, "*",
      "channel", channel,
      "payload", delayedPayload.payload,
      "timestamp", delayedPayload.timestamp,
      "attempt", delayedPayload.attempt,
      "exactlyOnce", delayedPayload.exactlyOnce,
      "dedupTTL", delayedPayload.dedupTTL,
      "pattern", delayedPayload.pattern or channel
    )

    redis.call("DEL", payloadKey)
  end

  redis.call("ZREM", delayedSetKey, messageId)
  count = count + 1
end

return count
