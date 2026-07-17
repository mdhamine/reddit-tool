<script setup lang="ts">
interface ExtractedLink {
  url: string;
  domain: string;
  tld: string;
  path: string;
}

interface ExtractResponse {
  fileName: string;
  totalLinksFound: number;
  links: ExtractedLink[];
  grouped: Record<string, ExtractedLink[]>;
}

const fileInput = ref<HTMLInputElement | null>(null);
const selectedFileName = ref("");
const loading = ref(false);
const error = ref("");
const result = ref<ExtractResponse | null>(null);
const activeTab = ref<"all" | "ai" | "com" | "co" | "so" | "app">("all");

const tabs: {
  key: "all" | "ai" | "com" | "co" | "so" | "app";
  label: string;
}[] = [
  { key: "all", label: "All" },
  { key: "ai", label: ".ai" },
  { key: "com", label: ".com" },
  { key: "co", label: ".co" },
  { key: "so", label: ".so" },
  { key: "app", label: ".app" },
];

const visibleLinks = computed(() => {
  if (!result.value) return [];
  if (activeTab.value === "all") return result.value.links;
  return result.value.grouped[activeTab.value] || [];
});

function triggerFilePicker() {
  fileInput.value?.click();
}

async function handleFileChange(e: Event) {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  selectedFileName.value = file.name;
  loading.value = true;
  error.value = "";
  result.value = null;
  activeTab.value = "all";

  const formData = new FormData();
  formData.append("file", file);

  try {
    const data = await $fetch<ExtractResponse>("/api/extract", {
      method: "POST",
      body: formData,
    });
    result.value = data;
  } catch (e: any) {
    error.value =
      e?.data?.statusMessage ||
      e?.message ||
      "Something went wrong extracting links from that file.";
  } finally {
    loading.value = false;
    // reset input so selecting the same file again still fires change
    target.value = "";
  }
}

function copyAll() {
  if (!visibleLinks.value.length) return;
  const text = visibleLinks.value.map((l) => l.url).join("\n");
  navigator.clipboard.writeText(text);
}

function downloadCsv() {
  if (!result.value) return;
  const rows = [
    ["url", "domain", "tld", "json_path"],
    ...result.value.links.map((l) => [l.url, l.domain, l.tld, l.path]),
  ];
  const csv = rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "extracted-links.csv";
  link.click();
}
</script>

<template>
  <div class="min-h-screen bg-neutral-950 text-neutral-100 font-sans">
    <div class="max-w-3xl mx-auto px-4 py-16">
      <header class="mb-10">
        <h1 class="text-3xl font-semibold tracking-tight">
          JSON Link Extractor
        </h1>
        <p class="mt-2 text-neutral-400">
          Upload a JSON file. We'll walk every string in it and pull out URLs
          ending in
          <span class="text-neutral-200 font-medium">.ai</span>,
          <span class="text-neutral-200 font-medium">.com</span>,
          <span class="text-neutral-200 font-medium">.co</span>,
          <span class="text-neutral-200 font-medium">.so</span>, and
          <span class="text-neutral-200 font-medium">.app</span>.
        </p>
      </header>

      <input
        ref="fileInput"
        type="file"
        accept="application/json,.json"
        class="hidden"
        @change="handleFileChange"
      />

      <div
        class="flex items-center gap-4 rounded-lg border border-dashed border-neutral-800 bg-neutral-900/40 px-5 py-6 cursor-pointer hover:border-neutral-700 transition-colors"
        @click="triggerFilePicker"
      >
        <button
          type="button"
          :disabled="loading"
          class="rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed px-5 py-3 text-sm font-medium transition-colors"
        >
          {{ loading ? "Extracting…" : "Choose JSON file" }}
        </button>
        <span class="text-sm text-neutral-500">
          {{ selectedFileName || "No file selected" }}
        </span>
      </div>

      <p
        v-if="error"
        class="mt-4 rounded-lg bg-red-950/50 border border-red-900 text-red-300 text-sm px-4 py-3"
      >
        {{ error }}
      </p>

      <div v-if="loading" class="mt-10 text-neutral-500 text-sm">
        Parsing file and walking the JSON tree…
      </div>

      <div v-if="result && !loading" class="mt-10">
        <div
          class="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4 mb-6"
        >
          <h2 class="font-medium text-neutral-100">{{ result.fileName }}</h2>
          <p class="text-xs text-neutral-500 mt-1">
            {{ result.totalLinksFound }} link{{
              result.totalLinksFound === 1 ? "" : "s"
            }}
            found
          </p>
        </div>

        <div class="flex items-center justify-between mb-4">
          <div class="flex gap-1 flex-wrap">
            <button
              v-for="tab in tabs"
              :key="tab.key"
              @click="activeTab = tab.key"
              class="px-3 py-1.5 text-xs rounded-md border transition-colors"
              :class="
                activeTab === tab.key
                  ? 'bg-orange-600 border-orange-600 text-white'
                  : 'border-neutral-800 text-neutral-400 hover:text-neutral-200'
              "
            >
              {{ tab.label }}
              <span class="opacity-60 ml-1">
                ({{
                  tab.key === "all"
                    ? result.totalLinksFound
                    : (result.grouped[tab.key]?.length ?? 0)
                }})
              </span>
            </button>
          </div>

          <div class="flex gap-2">
            <button
              @click="copyAll"
              class="text-xs px-3 py-1.5 rounded-md border border-neutral-800 text-neutral-400 hover:text-neutral-200"
            >
              Copy list
            </button>
            <button
              @click="downloadCsv"
              class="text-xs px-3 py-1.5 rounded-md border border-neutral-800 text-neutral-400 hover:text-neutral-200"
            >
              Download CSV
            </button>
          </div>
        </div>

        <div
          v-if="!visibleLinks.length"
          class="text-sm text-neutral-500 py-10 text-center border border-dashed border-neutral-800 rounded-lg"
        >
          No links found for this filter.
        </div>

        <ul
          v-else
          class="divide-y divide-neutral-800 border border-neutral-800 rounded-lg overflow-hidden"
        >
          <li
            v-for="(link, i) in visibleLinks"
            :key="link.url + i"
            class="p-4 hover:bg-neutral-900/60 transition-colors"
          >
            <a
              :href="link.url"
              target="_blank"
              rel="noopener"
              class="text-sm text-orange-400 hover:text-orange-300 break-all"
            >
              {{ link.url }}
            </a>
            <div class="mt-1 text-xs text-neutral-500 flex flex-wrap gap-x-3">
              <span class="uppercase">.{{ link.tld }}</span>
              <span class="break-all">{{ link.path }}</span>
            </div>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
