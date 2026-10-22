import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SMTPServer } from 'smtp-server';
import { simpleParser, type ParsedMail } from 'mailparser';
import { Container } from '@omnitron-dev/titan/nexus';
import {
  MailerService,
  MailerModule,
  MAILER,
  MailDeliveryError,
  MailTemplates,
  escapeMailHtml,
  smtpOptions,
} from '../src/index.js';
import type { MailMessage } from '../src/index.js';
import { MailerEmailChannel } from '../src/notifications.js';
import type { AddressInfo } from 'node:net';
const received: ParsedMail[] = [];
let reject: number | undefined;
let gate: Promise<void> | undefined;
let enter: (() => void) | undefined;
const server = new SMTPServer({
  authOptional: true,
  disabledCommands: ['AUTH', 'STARTTLS'],
  logger: false,
  onRcptTo(_address, _session, done) {
    if (reject) {
      const error = Object.assign(new Error('private recipient refusal'), { responseCode: reject });
      done(error);
    } else done();
  },
  onData(stream, _session, done) {
    void simpleParser(stream)
      .then(async (mail) => {
        enter?.();
        await gate;
        received.push(mail);
        done();
      })
      .catch(done);
  },
});
let smtp: string;
const services: MailerService[] = [];
function service(options: Partial<ConstructorParameters<typeof MailerService>[0]> = {}) {
  const result = new MailerService({
    smtp,
    from: 'synarc.ai <noreply@example.test>',
    allowInsecureLocalhost: true,
    ...options,
  });
  services.push(result);
  return result;
}
const mail = (overrides: Partial<MailMessage> = {}): MailMessage => ({
  to: 'reader@example.test',
  subject: 'Проверка / verification',
  text: 'Plain text',
  html: '<p>Plain text</p>',
  ...overrides,
});
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  smtp = `smtp://127.0.0.1:${(server.server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await Promise.all(services.splice(0).map((s) => s.close()));
  reject = undefined;
  gate = undefined;
  enter = undefined;
  received.length = 0;
});
afterAll(() => new Promise<void>((resolve) => server.close(resolve)));
describe('real SMTP and MIME', () => {
  it('verifies without sending and delivers UTF-8 multipart with an exact stable Message-ID', async () => {
    const s = service();
    await s.verify();
    expect(received).toHaveLength(0);
    const result = await s.send(
      mail({
        messageId: '<outbox-123@synarc.ai>',
        attachments: [{ filename: 'proof.txt', content: Buffer.from('verified') }],
      })
    );
    expect(result.accepted).toEqual(['reader@example.test']);
    expect(result.messageId).toBe('<outbox-123@synarc.ai>');
    const actual = received[0]!;
    expect(actual.subject).toBe('Проверка / verification');
    expect(actual.text?.trim()).toBe('Plain text');
    expect(actual.html).toBe('<p>Plain text</p>');
    expect(actual.messageId).toBe('<outbox-123@synarc.ai>');
    expect(actual.from?.value[0]?.address).toBe('noreply@example.test');
    expect(actual.attachments[0]?.content.toString()).toBe('verified');
  });
  it('classifies actual temporary and permanent SMTP failures without leaking server text', async () => {
    const s = service();
    for (const [status, kind] of [
      [451, 'transient'],
      [550, 'permanent'],
    ] as const) {
      reject = status;
      const error = await s.send(mail()).catch((e) => e);
      expect(error).toBeInstanceOf(MailDeliveryError);
      expect(error.kind).toBe(kind);
      expect(error.message).not.toContain('private');
      expect(error.cause).toBeUndefined();
    }
    expect(received).toHaveLength(0);
  });
  it('requires STARTTLS by default even on loopback and cannot silently downgrade', async () => {
    await expect(service({ allowInsecureLocalhost: false }).verify()).rejects.toMatchObject({ kind: 'configuration' });
    expect(received).toHaveLength(0);
  });
  it.each([
    { to: 'one@example.test, two@example.test' },
    { to: 'group: a@example.test;' },
    { subject: 'hello\r\nBcc: secret@example.test' },
    { to: 'a@example.test\nBcc: b@example.test' },
    { messageId: '<bad\n@example.test>' },
    { headers: { Bcc: 'secret@example.test' } },
    { text: '' },
    { html: { path: '/etc/passwd' } },
    { attachments: [{ filename: 'secret', path: '/etc/passwd' }] },
  ])('rejects unsafe message %j before SMTP', async (unsafe) => {
    await expect(service().send(mail(unsafe as Partial<MailMessage>))).rejects.toMatchObject({ kind: 'invalid' });
    expect(received).toHaveLength(0);
  });
  it('ignores injected envelope/file/transport fields on untyped callers', async () => {
    await service().send({
      ...mail(),
      envelope: { to: 'attacker@example.test' },
      disableFileAccess: false,
      raw: 'leak',
    } as MailMessage);
    expect(received[0]?.to).toMatchObject({ value: [{ address: 'reader@example.test' }] });
    expect(received[0]?.text?.trim()).toBe('Plain text');
  });
  it('bounds outstanding sends and drains before closing exactly once', async () => {
    let release!: () => void;
    gate = new Promise((r) => {
      release = r;
    });
    const entered = new Promise<void>((r) => {
      enter = r;
    });
    const s = service({ maxPending: 1 });
    const send = s.send(mail());
    await entered;
    await expect(s.send(mail())).rejects.toMatchObject({ kind: 'capacity', retryable: true });
    let closed = false;
    const close = s.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    await expect(s.send(mail())).rejects.toMatchObject({ kind: 'closed' });
    release();
    await send;
    await close;
    await s.close();
    expect(received).toHaveLength(1);
  });
  it('delivers through the standard notification email channel', async () => {
    const channel = new MailerEmailChannel(service());
    expect(await channel.isAvailable()).toBe(true);
    expect(await channel.send({ id: 'reader', email: 'reader@example.test' }, mail())).toMatchObject({ success: true });
    expect(received).toHaveLength(1);
  });
});
describe('configuration, templates and real Titan DI', () => {
  it.each(['smtp://a.example?tls.rejectUnauthorized=false', 'https://a.example', 'smtp://a.example/path'])(
    'rejects ambiguous SMTP configuration %s',
    (smtp) => {
      expect(() => smtpOptions({ smtp, from: 'a@example.test' })).toThrow(MailDeliveryError);
    }
  );
  it('does not permit cleartext remote SMTP and uses strict TLS settings', () => {
    expect(() =>
      smtpOptions({ smtp: 'smtp://mail.example', from: 'a@example.test', allowInsecureLocalhost: true })
    ).toThrow();
    expect(smtpOptions({ smtp: 'smtps://user:pass@mail.example:465', from: 'a@example.test' })).toMatchObject({
      secure: true,
      tls: { rejectUnauthorized: true },
      disableFileAccess: true,
      disableUrlAccess: true,
      maxRequeues: 0,
    });
  });
  it('renders a typed template and rejects missing plaintext or header injection', () => {
    const templates = new MailTemplates<{ hello: { name: string } }>({
      hello: ({ name }) => ({ subject: 'Hello', text: name, html: escapeMailHtml(name) }),
    });
    expect(templates.render('hello', { name: '<script>"&' }).html).toBe('&lt;script&gt;&quot;&amp;');
    expect(() => templates.render('hello', { name: '' })).toThrow();
  });
  it('resolves async options and both tokens to the same service, disposes the pool', async () => {
    const c = new Container();
    const SMTP = Symbol('smtp');
    c.register(SMTP, { useValue: smtp });
    await c.loadModuleAsync({
      name: 'MailerTest',
      ...MailerModule.forRootAsync({
        inject: [SMTP],
        useFactory: async (value: string) => ({
          smtp: value,
          from: 'a@example.test',
          allowInsecureLocalhost: true,
          verifyOnStart: true,
        }),
      }),
    });
    const s = await c.resolveAsync(MAILER);
    expect(await c.resolveAsync(MailerService)).toBe(s);
    await s.send(mail());
    await c.dispose();
    await expect(s.send(mail())).rejects.toMatchObject({ kind: 'closed' });
  });
});
