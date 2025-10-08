/**
 * Stream Service - Test service for WebSocket streams
 * Tests ReadableStream, WritableStream, and duplex streams
 */

import { Injectable } from '@omnitron-dev/titan/nexus';
import { Service, Public } from '@omnitron-dev/titan/netron';
import { Readable, Writable, Duplex } from 'stream';

export interface DataChunk {
  index: number;
  data: string;
  timestamp: string;
}

/**
 * Test Stream Service
 * Provides various stream operations for testing browser stream compatibility
 */
@Injectable()
@Service('StreamService@1.0.0')
export class StreamService {
  /**
   * Generate a readable stream of data chunks
   * Tests browser ReadableStream compatibility
   */
  @Public()
  async generateStream(count: number, intervalMs: number): Promise<Readable> {
    let index = 0;

    const readable = new Readable({
      objectMode: true,
      async read() {
        if (index >= count) {
          this.push(null); // End stream
          return;
        }

        // Wait before sending next chunk
        await new Promise(resolve => setTimeout(resolve, intervalMs));

        const chunk: DataChunk = {
          index: index++,
          data: `Chunk ${index}`,
          timestamp: new Date().toISOString()
        };

        this.push(chunk);
      }
    });

    return readable;
  }

  /**
   * Consume a writable stream
   * Tests browser WritableStream compatibility
   */
  @Public()
  async consumeStream(stream: Writable): Promise<{ received: number; summary: string }> {
    const chunks: any[] = [];

    return new Promise((resolve, reject) => {
      stream.on('data', (chunk) => {
        chunks.push(chunk);
      });

      stream.on('end', () => {
        resolve({
          received: chunks.length,
          summary: `Received ${chunks.length} chunks`
        });
      });

      stream.on('error', reject);
    });
  }

  /**
   * Echo stream - duplex operation
   * Tests bidirectional streaming
   */
  @Public()
  async echoStream(inputStream: Readable): Promise<Readable> {
    const outputStream = new Readable({
      objectMode: true,
      read() {}
    });

    inputStream.on('data', (chunk) => {
      // Echo back with modification
      const echoed = {
        ...chunk,
        echoed: true,
        echoedAt: new Date().toISOString()
      };
      outputStream.push(echoed);
    });

    inputStream.on('end', () => {
      outputStream.push(null);
    });

    inputStream.on('error', (err) => {
      outputStream.destroy(err);
    });

    return outputStream;
  }

  /**
   * Transform stream - map operation
   * Tests stream transformation
   */
  @Public()
  async transformStream(
    inputStream: Readable,
    operation: 'uppercase' | 'lowercase' | 'reverse'
  ): Promise<Readable> {
    const outputStream = new Readable({
      objectMode: true,
      read() {}
    });

    inputStream.on('data', (chunk) => {
      let transformed: any;

      if (typeof chunk === 'string') {
        switch (operation) {
          case 'uppercase':
            transformed = chunk.toUpperCase();
            break;
          case 'lowercase':
            transformed = chunk.toLowerCase();
            break;
          case 'reverse':
            transformed = chunk.split('').reverse().join('');
            break;
        }
      } else if (chunk && typeof chunk.data === 'string') {
        let data = chunk.data;
        switch (operation) {
          case 'uppercase':
            data = data.toUpperCase();
            break;
          case 'lowercase':
            data = data.toLowerCase();
            break;
          case 'reverse':
            data = data.split('').reverse().join('');
            break;
        }
        transformed = { ...chunk, data };
      } else {
        transformed = chunk;
      }

      outputStream.push(transformed);
    });

    inputStream.on('end', () => {
      outputStream.push(null);
    });

    inputStream.on('error', (err) => {
      outputStream.destroy(err);
    });

    return outputStream;
  }

  /**
   * Merge multiple streams
   * Tests complex stream operations
   */
  @Public()
  async mergeStreams(streams: Readable[]): Promise<Readable> {
    const outputStream = new Readable({
      objectMode: true,
      read() {}
    });

    let activeStreams = streams.length;

    streams.forEach((stream, index) => {
      stream.on('data', (chunk) => {
        outputStream.push({
          streamIndex: index,
          chunk
        });
      });

      stream.on('end', () => {
        activeStreams--;
        if (activeStreams === 0) {
          outputStream.push(null);
        }
      });

      stream.on('error', (err) => {
        outputStream.destroy(err);
      });
    });

    return outputStream;
  }

  /**
   * Large data stream
   * Tests streaming of large datasets
   */
  @Public()
  async streamLargeData(sizeMB: number, chunkSizeKB: number): Promise<Readable> {
    const totalBytes = sizeMB * 1024 * 1024;
    const chunkSize = chunkSizeKB * 1024;
    let bytesStreamed = 0;

    const readable = new Readable({
      read() {
        if (bytesStreamed >= totalBytes) {
          this.push(null);
          return;
        }

        const remainingBytes = totalBytes - bytesStreamed;
        const currentChunkSize = Math.min(chunkSize, remainingBytes);

        // Generate random data
        const buffer = Buffer.alloc(currentChunkSize);
        for (let i = 0; i < currentChunkSize; i++) {
          buffer[i] = Math.floor(Math.random() * 256);
        }

        bytesStreamed += currentChunkSize;
        this.push(buffer);
      }
    });

    return readable;
  }

  /**
   * Backpressure test stream
   * Tests proper backpressure handling
   */
  @Public()
  async backpressureStream(itemCount: number, fast: boolean): Promise<Readable> {
    let index = 0;
    const delay = fast ? 1 : 100;

    const readable = new Readable({
      objectMode: true,
      async read() {
        if (index >= itemCount) {
          this.push(null);
          return;
        }

        await new Promise(resolve => setTimeout(resolve, delay));

        this.push({
          index: index++,
          data: `Item ${index}`,
          timestamp: Date.now()
        });
      }
    });

    return readable;
  }
}
