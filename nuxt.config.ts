export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  devtools: { enabled: true },
  modules: ['@nuxtjs/tailwindcss'],
  runtimeConfig: {
    public: {}
  },
  app: {
    head: {
      title: 'Reddit Thread URL Extractor',
      meta: [
        { name: 'description', content: 'Paste a Reddit thread URL, scrape all comments, and extract .ai / .com / .app / .co domain links.' }
      ]
    }
  }
})
