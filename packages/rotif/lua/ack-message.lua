-- KEYS[1]: Stream key
-- ARGV[1]: Consumer group name
-- ARGV[2]: Message ID
-- ARGV[3]: Delete flag ("1" - delete after ack, "0" - keep)

local streamKey = KEYS[1]
local groupName = ARGV[1]
local messageId = ARGV[2]
local deleteFlag = ARGV[3]

-- Atomically acknowledge the message
local ackResult = redis.call('XACK', streamKey, groupName, messageId)

-- Optionally delete message from the stream
if deleteFlag == "1" then
  redis.call('XDEL', streamKey, messageId)
end

return ackResult
