import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import {
  ChannelManager,
  ChannelType,
  InAppChannel,
  EmailChannel,
  SMSChannel,
  ChannelContent,
  Recipient,
} from '../../../src/modules/notifications/channel-manager.js';
import type { NotificationPayload, SendOptions } from '../../../src/modules/notifications/notifications.service.js';

describe('ChannelManager', () => {
  let channelManager: ChannelManager;

  beforeEach(() => {
    jest.clearAllMocks();
    channelManager = new ChannelManager();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Channel Registration', () => {
    it('should register channels with priority', () => {
      const smsChannel = new SMSChannel();
      channelManager.registerChannel(smsChannel, 2);

      // Channel should be registered in the internal map
      expect(channelManager['channels'].has('sms')).toBe(true);
      expect(channelManager['channelPriorities'].get('sms')).toBe(2);
    });

    it('should register default channels on construction', () => {
      // ChannelManager constructor registers InApp and Email channels by default
      const manager = new ChannelManager();
      expect(manager['channels'].has('inApp')).toBe(true);
      expect(manager['channels'].has('email')).toBe(true);
    });

    it('should replace existing channel when registering with same name', () => {
      const emailChannel1 = new EmailChannel();
      const emailChannel2 = new EmailChannel();

      // Mock to distinguish between instances
      emailChannel2.formatContent = jest.fn();

      channelManager.registerChannel(emailChannel1, 1);
      channelManager.registerChannel(emailChannel2, 2);

      expect(channelManager['channels'].get('email')).toBe(emailChannel2);
      expect(channelManager['channelPriorities'].get('email')).toBe(2);
    });
  });

  describe('planDelivery', () => {
    it('should plan delivery across available channels', async () => {
      const emailChannel = new EmailChannel();
      const smsChannel = new SMSChannel();

      jest.spyOn(emailChannel, 'isAvailable').mockResolvedValue(true);
      jest.spyOn(emailChannel, 'validateRecipient').mockReturnValue(true);
      jest.spyOn(smsChannel, 'isAvailable').mockResolvedValue(true);
      jest.spyOn(smsChannel, 'validateRecipient').mockReturnValue(true);

      channelManager.registerChannel(emailChannel, 1);
      channelManager.registerChannel(smsChannel, 2);

      const recipients: Recipient[] = [{ id: 'user-1', email: 'user@example.com', phone: '+1234567890' }];

      const notification: NotificationPayload = {
        id: 'notif-1',
        type: 'info',
        title: 'Test',
        body: 'Test notification',
        data: {},
      };

      const options: SendOptions = {
        channels: [ChannelType.Email, ChannelType.SMS],
        channelStrategy: 'all',
      };

      const plan = await channelManager.planDelivery(recipients, notification, options);

      expect(plan.has('email')).toBe(true);
      expect(plan.has('sms')).toBe(true);
      expect(plan.get('email')?.recipients).toHaveLength(1);
      expect(plan.get('sms')?.recipients).toHaveLength(1);
    });

    it('should handle unavailable channels gracefully', async () => {
      const emailChannel = new EmailChannel();
      const smsChannel = new SMSChannel();

      jest.spyOn(emailChannel, 'isAvailable').mockResolvedValue(false);
      jest.spyOn(smsChannel, 'isAvailable').mockResolvedValue(true);
      jest.spyOn(smsChannel, 'validateRecipient').mockReturnValue(true);

      channelManager.registerChannel(emailChannel, 1);
      channelManager.registerChannel(smsChannel, 2);

      const recipients: Recipient[] = [{ id: 'user-1', phone: '+1234567890' }];

      const notification: NotificationPayload = {
        id: 'notif-1',
        type: 'error',
        title: 'Error',
        body: 'Something went wrong',
        data: {},
      };

      const options: SendOptions = {
        channels: [ChannelType.Email, ChannelType.SMS],
        channelStrategy: 'first-available',
      };

      const plan = await channelManager.planDelivery(recipients, notification, options);

      // Email channel is unavailable, so only SMS should be in the plan
      expect(plan.has('email')).toBe(false);
      expect(plan.has('sms')).toBe(true);
      expect(plan.get('sms')?.recipients).toHaveLength(1);
    });

    it('should skip channels not validated for recipients', async () => {
      const emailChannel = new EmailChannel();

      jest.spyOn(emailChannel, 'isAvailable').mockResolvedValue(true);
      jest.spyOn(emailChannel, 'validateRecipient').mockReturnValue(false);

      channelManager.registerChannel(emailChannel, 1);

      const recipients: Recipient[] = [
        { id: 'user-1' }, // No email address
      ];

      const notification: NotificationPayload = {
        id: 'notif-1',
        type: 'info',
        title: 'Test',
        body: 'Test',
        data: {},
      };

      const options: SendOptions = {
        channels: [ChannelType.Email],
        channelStrategy: 'all',
      };

      const plan = await channelManager.planDelivery(recipients, notification, options);

      // Should fallback to InApp channel since email validation fails
      expect(plan.has('email')).toBe(false);
      expect(plan.has('inApp')).toBe(true);
    });
  });
});

describe('InAppChannel', () => {
  let channel: InAppChannel;

  beforeEach(() => {
    channel = new InAppChannel();
  });

  it('should have correct type', () => {
    expect(channel.type).toBe(ChannelType.InApp);
  });

  it('should validate recipients', () => {
    const validRecipient = { id: 'user-1', email: 'user@example.com' };
    const invalidRecipient = { email: 'user@example.com' } as any; // Missing id

    expect(channel.validateRecipient(validRecipient)).toBe(true);
    expect(channel.validateRecipient(invalidRecipient)).toBe(false);
  });

  it('should send in-app notification', async () => {
    const content: ChannelContent = {
      subject: 'In-App Test',
      text: 'This is an in-app notification',
      data: { custom: 'data' },
    };

    const recipient: Recipient = { id: 'user-1' };

    // The send method should complete without error
    await expect(channel.send(recipient, content)).resolves.not.toThrow();
  });
});

describe('EmailChannel', () => {
  let channel: EmailChannel;

  beforeEach(() => {
    channel = new EmailChannel();
  });

  it('should have correct type', () => {
    expect(channel.type).toBe(ChannelType.Email);
  });

  it('should validate recipients with email', () => {
    const validRecipient: Recipient = { id: 'user-1', email: 'user@example.com' };
    const invalidRecipient: Recipient = { id: 'user-1', phone: '+1234567890' } as any;
    const invalidEmail: Recipient = { id: 'user-1', email: 'invalid-email' };

    expect(channel.validateRecipient(validRecipient)).toBe(true);
    expect(channel.validateRecipient(invalidRecipient)).toBe(false);
    expect(channel.validateRecipient(invalidEmail)).toBe(false);
  });

  it('should send email notification', async () => {
    const content: ChannelContent = {
      subject: 'Test Email',
      html: '<p>Email body content</p>',
      text: 'Email body content',
    };

    const recipient: Recipient = {
      id: 'user-1',
      email: 'user@example.com',
    };

    // The send method should complete without error for valid recipient
    await expect(channel.send(recipient, content)).resolves.not.toThrow();
  });

  it('should handle email sending failure', async () => {
    const content: ChannelContent = {
      subject: 'Test',
      text: 'Test',
    };

    const recipient: Recipient = { id: 'user-1' }; // No email

    await expect(channel.send(recipient, content)).rejects.toThrow('Recipient email not provided');
  });
});

describe('SMSChannel', () => {
  let channel: SMSChannel;

  beforeEach(() => {
    channel = new SMSChannel();
  });

  it('should have correct type', () => {
    expect(channel.type).toBe(ChannelType.SMS);
  });

  it('should validate recipients with phone', () => {
    const validRecipient: Recipient = { id: 'user-1', phone: '+12345678901' };
    const invalidRecipient: Recipient = { id: 'user-1', email: 'user@example.com' } as any;
    const invalidPhone: Recipient = { id: 'user-1', phone: '123' };

    expect(channel.validateRecipient(validRecipient)).toBe(true);
    expect(channel.validateRecipient(invalidRecipient)).toBe(false);
    expect(channel.validateRecipient(invalidPhone)).toBe(false);
  });

  it('should send SMS notification', async () => {
    const content: ChannelContent = {
      message: 'This is an SMS message',
    };

    const recipient: Recipient = {
      id: 'user-1',
      phone: '+12345678901',
    };

    // The send method should complete without error for valid recipient
    await expect(channel.send(recipient, content)).resolves.not.toThrow();
  });

  it('should handle SMS character limits in formatContent', () => {
    const longBody = 'a'.repeat(200); // More than 160 chars
    const notification: NotificationPayload = {
      id: 'notif-1',
      type: 'info',
      title: 'Test',
      body: longBody,
      data: {},
    };

    const content = channel.formatContent(notification);

    expect(content.message).toBeDefined();
    expect(content.message!.length).toBeLessThanOrEqual(160);
  });
});
