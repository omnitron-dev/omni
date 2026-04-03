-- KEYS[1]: DLQ stream key (rotif:dlq)
-- ARGV[1]: Maximum number of messages to requeue

local dlqKey = KEYS[1]
local count = tonumber(ARGV[1])

local entries = redis.call('XRANGE', dlqKey, '-', '+', 'COUNT', count)
local requeued = 0

for _, entry in ipairs(entries) do
  local id = entry[1]
  local fields = entry[2]

  local channel, payload, timestamp, streamKey
  for i = 1, #fields, 2 do
    if fields[i] == 'channel' then
      channel = fields[i+1]
    elseif fields[i] == 'payload' then
      payload = fields[i+1]
    elseif fields[i] == 'timestamp' then
      timestamp = fields[i+1]
    elseif fields[i] == 'streamKey' then
      streamKey = fields[i+1]
    end
  end

  if channel and payload and streamKey and streamKey ~= "" then
    redis.call('XADD', streamKey, '*',
      'channel', channel,
      'payload', payload,
      'timestamp', timestamp or tostring(redis.call('TIME')[1] * 1000),
      'attempt', '1'
    )

    redis.call('XDEL', dlqKey, id)
    requeued = requeued + 1
  end
end

return requeued
