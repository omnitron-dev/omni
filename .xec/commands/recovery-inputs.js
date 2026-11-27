export function command(program) {
  program.command('recovery-inputs').description('Stage checked release bytes and Git probe on the Linux qualification node')
    .requiredOption('--definition <file>', 'Native qualification Pipeline JSON')
    .requiredOption('--store <dir>', 'QA release store holding all three issued releases')
    .requiredOption('--source <dir>', 'QA project Git repository containing the exact reviewed probe commit')
    .allowExcessArguments(false)
    .action(async values => {
      if (process.platform !== 'linux') throw Error('Run input staging on the enrolled Linux qualification node');
      const { stageRecoveryInputs } = await import('../../apps/omnitron/dist/services/recovery-inputs.js');
      console.log(JSON.stringify(await stageRecoveryInputs(values.definition, values.store, values.source)));
    });
}
