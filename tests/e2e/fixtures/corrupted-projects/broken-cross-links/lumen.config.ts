import { defineLumenConfig } from '@omnitron-dev/lumen';

export default defineLumenConfig({
  title: 'Broken Links Project',
  url: 'https://broken.example.com',
  baseUrl: '/',
  onBrokenLinks: 'throw',
});
