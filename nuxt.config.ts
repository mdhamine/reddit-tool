import { defineNuxtConfig } from "nuxt/config";

export default defineNuxtConfig({
  devtools: { enabled: true },
  runtimeConfig: {
    gmailUser: process.env.NUXT_GMAIL_USER,
    gmailAppPassword: process.env.NUXT_GMAIL_APP_PASSWORD,
    public: {},
  },
  modules: ["@nuxtjs/tailwindcss"],
  app: {
    head: {
      title: "Reddit T hread URL Extractor",
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
