import { defineLumenConfig } from '@omnitron-dev/lumen';

export default defineLumenConfig({
  title: 'Broken Anchors Project',
  url: 'https://anchors.example.com',
  baseUrl: '/',
  onBrokenAnchors: 'throw',
});
