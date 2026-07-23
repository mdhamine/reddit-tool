export default defineNuxtConfig({
  compatibilityDate: "2024-11-01",
  devtools: { enabled: true },
  runtimeConfig: {
    gmailUser: process.env.NUXT_GMAIL_USER,
    gmailAppPassword: process.env.NUXT_GMAIL_APP_PASSWORD,
    public: {},
  },
  modules: ["@nuxtjs/tailwindcss"],
  app: {
    head: {
      title: "Reddit Thread URL Extractor",
      meta: [
        {
          name: "description",
          content:
            "Paste a Reddit thread URL, scrape all comments, and extract .ai / .com / .app / .co domain links.",
        },
      ],
    },
  },
});
