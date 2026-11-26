-- The consumer group can redeliver a notification while a slow provider is
-- still handling it. Only the holder of this claim may record the outcome.
local key = KEYS[1]
local phase = redis.call('HGET', key, 'phase')
local action = ARGV[1]
if action == 'claim' then
  if phase ~= 'scheduled' or redis.call('HGET', key, 'member') ~= ARGV[4] then return false end
  local time = redis.call('TIME')
  local now = time[1] * 1000 + math.floor(time[2] / 1000)
  if tonumber(redis.call('HGET', key, 'due')) > now then return redis.error_reply('Notification is not due') end
  redis.call('HSET', key, 'phase', 'delivering', 'token', ARGV[2], 'result', ARGV[3])
  return redis.call('HGET', key, 'body')
end
if action == 'cancel' then
  if phase == 'cancelled' then return 1 end
  if phase ~= 'scheduled' then return 0 end
  local member = redis.call('HGET', key, 'member')
  redis.call('ZREM', KEYS[2], member)
  redis.call('DEL', 'rotif:delayed:' .. member)
elseif action == 'finish' then
  if phase ~= 'delivering' or redis.call('HGET', key, 'token') ~= ARGV[2] then return 0 end
else
  return redis.error_reply('Unknown notification receipt transition')
end
redis.call('HSET', key, 'phase', action == 'cancel' and 'cancelled' or 'finished', 'result', ARGV[3])
redis.call('HDEL', key, 'token', 'body', 'member')
if tonumber(ARGV[4]) > 0 then redis.call('EXPIRE', key, ARGV[4]) end
return 1
