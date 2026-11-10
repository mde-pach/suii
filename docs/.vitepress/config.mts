import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'suii',
  description: 'Step User Interactive Input: ask people a question from a GitHub Actions step, and get the answer as outputs.',
  base: '/suii/',
  cleanUrls: true,
  lastUpdated: true,
  head: [['link', { rel: 'icon', href: '/suii/favicon.svg', type: 'image/svg+xml' }]],
  markdown: {
    // Liquid and Actions expressions ({{ ... }}) in inline code must not be read as Vue interpolation.
    config(md) {
      const render = md.renderer.rules.code_inline!;
      md.renderer.rules.code_inline = (...args) => render(...args).replace('<code', '<code v-pre');
    },
  },
  themeConfig: {
    logo: '/favicon.svg',
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Reference', link: '/reference/inputs-outputs' },
      { text: 'Examples', link: '/examples' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting started', link: '/guide/getting-started' },
          { text: 'Templates', link: '/guide/templates' },
          { text: 'Field types', link: '/guide/field-types' },
          { text: 'How it works', link: '/guide/how-it-works' },
          { text: 'Security', link: '/guide/security' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Inputs and outputs', link: '/reference/inputs-outputs' },
          { text: 'Outcomes', link: '/reference/outcomes' },
        ],
      },
      { text: 'Examples', link: '/examples' },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/mde-pach/suii' }],
    editLink: { pattern: 'https://github.com/mde-pach/suii/edit/main/docs/:path' },
    search: { provider: 'local' },
    footer: { message: 'Released under the MIT License.' },
  },
});
