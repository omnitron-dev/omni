/**
 * Configuration for transporters
 * Configuration by transporter :
 * @param {Integer} enabled
 * @param {Object|String} endpoints sended as first arg with connect() method
 */
module.exports = {
  transporters: {
    websocket: {
      enabled: true,
      endpoints: process.env.AGENT_WEBSOCKET_ENDPOINT || 'ws',
    },
  },
};
