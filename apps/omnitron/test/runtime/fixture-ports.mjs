import net from 'node:net';

export async function reserveDaemonPorts(additional = 0) {
  for (let attempt = 0; attempt < 32; attempt++) {
    const listeners = [];
    const listen = async (port = 0) => {
      const server = net.createServer();
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
      });
      listeners.push(server.unref());
      return server.address().port;
    };
    const release = () => Promise.all(listeners.map(server => new Promise(resolve => server.close(resolve))));
    try {
      const httpPort = await listen();
      // The daemon derives internal HTTP and WebSocket listeners from the Console port.
      if (httpPort <= 65533) {
        await listen(httpPort + 1);
        await listen(httpPort + 2);
        const ports = [];
        for (let i = 0; i < additional; i++) ports.push(await listen());
        return { httpPort, ports, release };
      }
    } catch (error) {
      if (error.code !== 'EADDRINUSE') { await release(); throw error; }
    }
    await release();
  }
  throw Error('Could not reserve a contiguous daemon HTTP/WebSocket range and separate fixture listeners');
}
