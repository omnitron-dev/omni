-- KEYS[1]: Stream key
-- KEYS[2]: Sorted Set key for delayed messages
-- ARGV[1]: payload
-- ARGV[2]: Timestamp
-- ARGV[3]: Channel name
-- ARGV[4]: Attempt count
-- ARGV[5]: Delivery type ("normal" или "delayed")
-- ARGV[6]: Delay timestamp (если delayed) или "0"
-- ARGV[7]: Max stream length (или "0" если нет ограничения)
-- ARGV[8]: Min stream ID (или "" если нет ограничения)
-- ARGV[9]: Deduplication key ("" если не используется)
-- ARGV[10]: Deduplication TTL (seconds, "0" если не используется)
-- ARGV[11]: Message ID (для надёжного удаления)
-- ARGV[12]: Exactly once (true/false)
-- ARGV[13]: Pattern (for deduplication key consistency)

local streamKey = KEYS[1]
local delayedSetKey = KEYS[2]
local payload = ARGV[1]
local timestamp = ARGV[2]
local channel = ARGV[3]
local attempt = ARGV[4]
local deliveryType = ARGV[5]
local delayTimestamp = tonumber(ARGV[6])
local maxStreamLength = tonumber(ARGV[7])
local minStreamId = ARGV[8]
local dedupKey = ARGV[9]
local dedupTTL = tonumber(ARGV[10])
local messageUUID = ARGV[11]
local exactlyOnce = ARGV[12]
local pattern = ARGV[13]
-- An optional receipt binds a scheduled job ID to its immutable request.
-- The delayed member and the receipt are committed in the same invocation.
local receiptKey = KEYS[3]
if receiptKey then
  local existing = redis.call('HGET', receiptKey, 'fingerprint')
  if existing and existing ~= ARGV[14] then return redis.error_reply('Notification ID already used for another request') end
  if existing then return redis.call('HGET', receiptKey, 'result') end
end

-- Input validation
if not channel or channel == "" then
  return redis.error_reply("Channel is required")
end
if not payload then
  return redis.error_reply("Payload is required")
end

if dedupKey ~= "" and redis.call("EXISTS", dedupKey) == 1 then
  return "DUPLICATE"
end

redis.call('ZADD', 'rotif:channels', 0, channel)

if deliveryType == "delayed" then
  local delayedMessage = cjson.encode({
    streamKey = streamKey,
    channel = channel,
    payload = payload,
    timestamp = timestamp,
    attempt = attempt,
    exactlyOnce = exactlyOnce,
    dedupTTL = ARGV[10],
    pattern = pattern
  })

  redis.call("ZADD", delayedSetKey, delayTimestamp, messageUUID)
  redis.call("SET", "rotif:delayed:" .. messageUUID, delayedMessage)
  if receiptKey then
    redis.call('HSET', receiptKey, 'fingerprint', ARGV[14], 'body', ARGV[15], 'result', ARGV[16],
      'phase', 'scheduled', 'due', ARGV[6], 'member', messageUUID)
    return ARGV[16]
  end
  
  if dedupKey ~= "" and dedupTTL > 0 then
    redis.call("SET", dedupKey, "1", "EX", dedupTTL)
  end

  return "SCHEDULED"
else
  local id = redis.call("XADD", streamKey, "*",
    "channel", channel,
    "payload", payload,
    "timestamp", timestamp,
    "attempt", attempt,
    "exactlyOnce", exactlyOnce,
    "dedupTTL", ARGV[10],
    "pattern", pattern
  )

  if maxStreamLength > 0 then
    redis.call("XTRIM", streamKey, "MAXLEN", "~", maxStreamLength)
  elseif minStreamId ~= "" then
    redis.call("XTRIM", streamKey, "MINID", "~", minStreamId)
  end

  if dedupKey ~= "" and dedupTTL > 0 then
    redis.call("SET", dedupKey, "1", "EX", dedupTTL)
  end

  return id
end
