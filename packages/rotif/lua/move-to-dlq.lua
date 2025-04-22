-- KEYS[1]: Stream key
-- KEYS[2]: DLQ Stream key (rotif:dlq)
-- ARGV[1]: Consumer Group
-- ARGV[2]: Message ID
-- ARGV[3]: Channel
-- ARGV[4]: Payload JSON
-- ARGV[5]: Error message
-- ARGV[6]: Original timestamp
-- ARGV[7]: Attempt count

local streamKey = KEYS[1]
local dlqKey = KEYS[2]

local consumerGroup = ARGV[1]
local messageId = ARGV[2]
local channel = ARGV[3]
local payload = ARGV[4]
local errorMessage = ARGV[5]
local originalTimestamp = ARGV[6]
local attemptCount = ARGV[7]

-- Acknowledge the original message
redis.call("XACK", streamKey, consumerGroup, messageId)

-- Move message to DLQ
redis.call("XADD", dlqKey, "*",
  "channel", channel,
  "payload", payload,
  "error", errorMessage,
  "timestamp", originalTimestamp,
  "attempt", attemptCount
)

return "MOVED_TO_DLQ"
