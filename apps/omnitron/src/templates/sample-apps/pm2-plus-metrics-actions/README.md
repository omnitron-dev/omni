
# omnitron custom metrics boilerplate

In this boilerplate you will discover a working example of custom metrics feature.

Metrics covered are:
- io.metric
- io.counter
- io.meter
- io.histogram

## What is Custom Metrics?

Custom metrics is a powerfull way to get more visibility from a running application. It will allow you to monitor in realtime the current value of variables, know the number of actions being processed, measure latency and much more.

Once you have plugged in some custom metrics you will be able to monitor their value in realtime with

`omnitron monit`

Or

`omnitron describe`

Or on the OMNITRON+ Web interface

`omnitron open`

## Example

```javascript
const io = require('@pm2/io')

const currentReq = io.counter({
  name: 'CM: Current Processing',
  type: 'counter'
})

setInterval(() => {
  currentReq.inc()
}, 1000)
```

## Documentation

https://doc.omnitron.io/en/plus/guide/custom-metrics/
