import { randomUUID } from 'node:crypto';
import { flowCatalog } from '../../../src/shared/dto/flows.ts';
import { expect, stubInventory, test } from './fixtures.mjs';

test('two administrators review public documents, send separately and recover the original receipt from a new tab', async ({
  page,
  context,
  browser,
  url,
}) => {
  const workspace = { project: 'example', stack: 'dev' },
    nodeId = randomUUID(),
    id = randomUUID(),
    revision = '1'.repeat(64);
  const definition = {
    version: 1,
    name: 'Manual notification',
    nodes: [
      { id: 'start', type: 'input.manual@1', config: {} },
      { id: 'notice', type: 'output.notify@1', config: { title: 'Ready for review' } },
    ],
    edges: [{ from: 'start', port: 'event', to: 'notice' }],
  };
  const saved = { id, workspace, revision, definition, active: null, updatedAt: 1, sources: [] };
  const receipt = { id: randomUUID(), workspace, revision: '4'.repeat(64) };
  const sent = [],
    issued = [];
  let offer,
    ticket,
    received = false;
  const targetContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  try {
    await stubInventory(
      context,
      {
        'OmnitronFlows.get': () => saved,
        'OmnitronFlows.catalog': { nodes: flowCatalog, diagnostics: [] },
        'OmnitronNodes.listNodes': [
          { id: nodeId, name: 'Receiving controller', host: '127.0.0.1', isLocal: false },
          { id: randomUUID(), name: 'Local controller', host: 'localhost', isLocal: true },
        ],
        'OmnitronFlowReviews.prepare': (input) => {
          expect(input).toMatchObject({ workspace, id, revision, nodeId });
          offer = {
            version: 1,
            transferId: input.transferId,
            workspace,
            sourceRegistration: '2'.repeat(64),
            sourceRevision: revision,
            digest: '3'.repeat(64),
            senderKey: 'A'.repeat(59),
          };
          return offer;
        },
        'OmnitronFlowReviews.deliver': (input) => {
          sent.push(input);
          if (input.mode === 'receipt') return received ? receipt : null;
          received = true;
          return Error('Response was lost after delivery');
        },
      },
      'online',
      { role: 'admin', userId: 'source-admin' }
    );
    await stubInventory(
      targetContext,
      {
        'OmnitronFlows.list': { items: [], next: null },
        'OmnitronFlowReviews.invite': (input) => {
          issued.push(input);
          ticket = {
            offer: input.offer,
            destinationRegistration: '5'.repeat(64),
            expiresAt: Date.now() + 600000,
            destinationKey: 'B'.repeat(59),
            encryptionKey: 'C'.repeat(59),
          };
          return ticket;
        },
        'OmnitronFlowReviews.revoke': () => null,
        'OmnitronFlowReviews.incomingReceipt': (input) => {
          expect(input).toEqual({ workspace, offer });
          return received ? receipt : null;
        },
      },
      'online',
      { role: 'admin', userId: 'target-admin' }
    );
    const link = url + '/projects/example/flows?flow=' + id + '&stack=dev';
    await page.goto(link);
    await page.getByRole('button', { name: 'Share with a controller' }).click();
    const source = page.getByRole('dialog');
    const choose = async (dialog) => {
      await dialog.getByRole('combobox', { name: 'Receiving controller' }).click();
      await expect(page.getByRole('option', { name: /Local controller/ })).toHaveCount(0);
      await page.getByRole('option', { name: /Receiving controller/ }).click();
    };
    await choose(source);
    await expect(source.getByText('notice · Local notification · Ready for review')).toBeVisible();
    await expect(source.getByText('start · event → notice')).toBeVisible();
    await source.getByRole('button', { name: 'Prepare public offer' }).click();
    const offerText = await source.getByRole('textbox', { name: 'Public offer', exact: true }).inputValue();
    expect(offerText).not.toContain('Ready for review');
    const target = await targetContext.newPage();
    await target.goto(url + '/projects/example/flows?stack=dev');
    await target.getByRole('button', { name: 'Receive a flow' }).click();
    const targetDialog = target.getByRole('dialog');
    const input = targetDialog.getByRole('textbox', { name: 'Public offer from sender' });
    await input.fill(JSON.stringify({ ...offer, workspace: { project: 'other' } }));
    await expect(targetDialog.getByRole('button', { name: 'Issue invitation' })).toBeDisabled();
    await input.fill(offerText);
    await expect(targetDialog.getByText('Source registration ' + offer.sourceRegistration)).toBeVisible();
    expect(issued).toHaveLength(0);
    await targetDialog.getByRole('button', { name: 'Issue invitation' }).click();
    const ticketText = await targetDialog.getByRole('textbox', { name: 'Public invitation', exact: true }).inputValue();
    expect(issued).toEqual([{ workspace, offer }]);
    await target.screenshot({ path: test.info().outputPath('receiving-invitation-mobile.png') });
    const invitationInput = source.getByRole('textbox', { name: 'Invitation from receiving controller' });
    await invitationInput.fill(JSON.stringify({ ...ticket, expiresAt: {} }));
    await expect(source.getByRole('button', { name: 'Send reviewed graph' })).toBeDisabled();
    await invitationInput.fill(ticketText);
    expect(sent).toEqual([]);
    await source.getByRole('button', { name: 'Check receipt' }).click();
    await expect(source.getByText('The receiving controller has not recorded this transfer.')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('reviewed-transfer-desktop.png') });
    await source.getByRole('button', { name: 'Send reviewed graph' }).click();
    await expect(source.getByRole('alert')).toContainText('Response was lost');
    await targetDialog.getByRole('button', { name: 'Check incoming transfer' }).click();
    await expect(targetDialog.getByRole('link', { name: 'Open received draft' })).toHaveAttribute(
      'href',
      '/projects/example/flows?flow=' + receipt.id + '&stack=dev'
    );
    const replacement = await context.newPage();
    await replacement.goto(link);
    await replacement.getByRole('button', { name: 'Share with a controller' }).click();
    const recovery = replacement.getByRole('dialog');
    await recovery.getByRole('combobox', { name: 'Receiving controller' }).click();
    await replacement.getByRole('option', { name: /Receiving controller/ }).click();
    await recovery.getByRole('textbox', { name: 'Invitation from receiving controller' }).fill(ticketText);
    await recovery.getByRole('button', { name: 'Check receipt' }).click();
    await expect(
      recovery.getByText('Received on the other controller · draft ' + receipt.id + ' · revision ' + receipt.revision)
    ).toBeVisible();
    expect(sent.map((entry) => entry.mode)).toEqual(['receipt', 'send', 'receipt']);
    for (const { mode: _mode, ...entry } of sent)
      expect(entry).toEqual({ workspace, id, revision, nodeId, invitation: ticket });
    await replacement.keyboard.press('Escape');
    await expect(replacement.getByRole('dialog')).toHaveCount(0);
  } finally {
    await targetContext.close();
  }
});

test('ordinary flow readers see their inventory with no cross-controller authority', async ({ page, context, url }) => {
  await stubInventory(context, { 'OmnitronFlows.list': { items: [], next: null } }, 'online', { role: 'operator' });
  await page.goto(url + '/projects/example/flows');
  await expect(page.getByText('No saved flows in this workspace.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Receive a flow' })).toHaveCount(0);
});
