import type { IncomingMessage, ServerResponse } from 'node:http';
import { LiveEditService } from '../live/live-edit.service.js';

export function handleSseMcpConnection(
  req: IncomingMessage,
  res: ServerResponse,
  liveEditService: LiveEditService
): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // Initial connection heartbeat
  res.write(`event: ready\ndata: ${JSON.stringify({ status: 'connected', timestamp: Date.now() })}\n\n`);

  const listener = (event: any) => {
    if (res.writableEnded || (res as any).destroyed) {
      cleanup();
      return;
    }
    try {
      res.write(`event: live-edit\ndata: ${JSON.stringify(event)}\n\n`);
    } catch {
      cleanup();
    }
  };

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    liveEditService.off('live-edit', listener);
  };

  liveEditService.on('live-edit', listener);

  req.on('close', cleanup);
  req.on('error', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
}
