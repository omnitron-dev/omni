import { parseTwoslashAnnotations } from '@omnitron-dev/lumen-ast';

const source = document.querySelector<HTMLTextAreaElement>('#source')!;
const result = document.querySelector<HTMLOutputElement>('#result')!;
document.querySelector('#analyze')!.addEventListener('click', () => {
  try {
    result.textContent = JSON.stringify(parseTwoslashAnnotations(source.value));
    result.dataset.status = 'complete';
  } catch (error) {
    result.textContent = String(error);
    result.dataset.status = 'error';
  }
});
