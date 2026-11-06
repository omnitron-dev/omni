import net from 'node:net';

export async function reserveDaemonPorts(additional = 0, requested, createServer = () => net.createServer()) {
  if (requested) {
    const values = [requested.httpPort, requested.httpPort + 1, requested.httpPort + 2, requested.httpPort + 3, ...requested.ports];
    if (requested.ports.length !== additional || values.some(port => !Number.isInteger(port) || port < 1 || port > 65535) || new Set(values).size !== values.length)
      throw Error('Invalid exact fixture port reservation');
  }
  for (let attempt = 0; attempt < (requested ? 1 : 32); attempt++) {
    const listeners = [];
    const listen = async (port = 0) => {
      const server = createServer();
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
      });
      listeners.push(server.unref());
      return server.address().port;
    };
    let released;
    const release = () => released ??= Promise.all(listeners.map(server => new Promise(resolve => server.close(resolve))));
    try {
      const httpPort = await listen(requested?.httpPort);
      // Netron HTTP, WebSocket and the metrics listener occupy the next three ports.
      if (httpPort <= 65532) {
        await listen(httpPort + 1);
        await listen(httpPort + 2);
        await listen(httpPort + 3);
        const ports = [];
        for (let i = 0; i < additional; i++) ports.push(await listen(requested?.ports[i]));
        return { httpPort, ports, release };
      }
    } catch (error) {
      if (requested || error.code !== 'EADDRINUSE') { await release(); throw error; }
    }
    await release();
  }
  throw Error('Could not reserve a contiguous daemon HTTP/WebSocket/metrics range and separate fixture listeners');
}
