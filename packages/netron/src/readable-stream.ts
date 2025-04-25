import { Readable, ReadableOptions } from 'stream';

import { Packet } from './packet';
import { RemotePeer } from './remote-peer';

const MAX_BUFFER_SIZE = 10_000;


export interface NetronReadableStreamOptions extends ReadableOptions {
  peer: RemotePeer;
  streamId: number;
  isLive?: boolean;
}

export class NetronReadableStream extends Readable {
  public readonly peer: RemotePeer;
  private buffer: Map<number, any> = new Map();
  private expectedIndex: number = 0;
  private timeout?: NodeJS.Timeout;
  public readonly id: number;
  private isClosed: boolean = false;
  public isComplete: boolean = false;
  public isLive: boolean;

  constructor({ peer, streamId, isLive = false, ...opts }: NetronReadableStreamOptions) {
    super({ ...opts, objectMode: true });

    this.peer = peer;
    this.id = streamId;
    this.isLive = isLive;

    this.peer.readableStreams.set(this.id, this);

    if (!this.isLive) {
      this.resetTimeout();
    }

    this.on('close', this.cleanup);
    this.on('error', this.handleError);
  }

  /**
   * Обрабатывает входящие пакеты и управляет порядком получения данных.
   */
  public onPacket(packet: Packet): void {
    if (this.isClosed) return;

    this.resetTimeout();

    if (this.buffer.size > MAX_BUFFER_SIZE) {
      this.destroy(new Error(`Buffer overflow: more than ${MAX_BUFFER_SIZE} packets buffered`));
      return;
    }

    this.buffer.set(packet.streamIndex!, packet.data);

    while (this.buffer.has(this.expectedIndex)) {
      const chunk = this.buffer.get(this.expectedIndex);
      this.buffer.delete(this.expectedIndex);
      this.expectedIndex++;

      if (!this.push(chunk)) {
        // Если внутренний буфер полон, ждем следующего события 'readable'
        break;
      }
    }

    if (packet.isLastChunk()) {
      this.isComplete = true;
      this.closeStream(true);
    }
  }

  /**
   * Реализация метода _read интерфейса Readable.
   */
  override _read(): void {
    // Поскольку данные пушатся в onPacket, тут нам ничего делать не нужно.
    // Этот метод необходим для корректной работы Readable.
  }

  /**
   * Перезапускает таймер неактивности потока.
   */
  private resetTimeout(): void {
    if (this.isLive) return;

    if (this.timeout) clearTimeout(this.timeout);

    const timeoutDuration = this.peer.netron.options?.streamTimeout ?? 60000;

    this.timeout = setTimeout(() => {
      const message = `Stream ${this.id} inactive for ${timeoutDuration}ms, closing.`;
      console.warn(message);
      this.destroy(new Error(message));
    }, timeoutDuration);
  }

  /**
   * Закрывает поток и очищает все ресурсы.
   */
  public closeStream(force: boolean = false): void {
    if (this.isClosed) return;

    if (this.isLive && !force) {
      console.warn(`Attempt to close live stream ${this.id}, operation ignored.`);
      return;
    }

    this.push(null);

    if (this.isLive && force) {
      this.destroy(); // вызываем destroy только для live или forced завершения
    }
  }

  /**
   * Очищает ресурсы и удаляет поток из управления peer.
   */
  private cleanup = (): void => {
    if (this.timeout) clearTimeout(this.timeout);
    this.peer.readableStreams.delete(this.id);
    this.buffer.clear();
  };

  /**
   * Обрабатывает ошибку потока.
   */
  private handleError = (error: Error): void => {
    console.error(`NetronReadableStream (id: ${this.id}) error:`, error.message);
    this.cleanup();
  };

  /**
   * Переопределение метода destroy для корректного закрытия потока при ошибках.
   */
  public override destroy(error?: Error): this {
    if (this.isClosed) return this;

    this.isClosed = true;
    super.destroy(error);
    this.cleanup();

    return this;
  }

  /**
   * Статический фабричный метод для удобного создания инстанса.
   */
  public static create(peer: RemotePeer, streamId: number, isLive: boolean = false): NetronReadableStream {
    return new NetronReadableStream({ peer, streamId, isLive });
  }
}
