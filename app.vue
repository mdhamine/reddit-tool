<script setup lang="ts">
interface ExtractedLink {
  url: string;
  domain: string;
  tld: string;
  path: string;
  sourceFile: string;
}

interface ExtractResponse {
  fileNames: string[];
  fileCount: number;
  totalLinksFound: number;
  links: ExtractedLink[];
  grouped: Record<string, ExtractedLink[]>;
  errors: string[];
}

const fileInput = ref<HTMLInputElement | null>(null);
const selectedFileNames = ref<string[]>([]);
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
  if (activeTab.value === "all") return result.value.links ?? [];
  return result.value.grouped?.[activeTab.value] ?? [];
});

function tabCount(key: "all" | "ai" | "com" | "co" | "so" | "app") {
  if (!result.value) return 0;
  if (key === "all") return result.value.totalLinksFound ?? 0;
  return result.value.grouped?.[key]?.length ?? 0;
}

function triggerFilePicker() {
  fileInput.value?.click();
}

async function handleFileChange(e: Event) {
  const target = e.target as HTMLInputElement;
  const files = target.files;
  if (!files || !files.length) return;

  selectedFileNames.value = Array.from(files).map((f) => f.name);
  loading.value = true;
  error.value = "";
  result.value = null;
  activeTab.value = "all";

  const formData = new FormData();
  // Append every selected file under the same field name — the backend
  // now collects all "file" entries instead of just the first one.
  for (const file of Array.from(files)) {
    formData.append("file", file);
  }

  try {
    const data = await $fetch<ExtractResponse>("/api/scrape", {
      method: "POST",
      body: formData,
    });

    if (!data || typeof data !== "object" || !Array.isArray(data.links)) {
      error.value =
        "Server returned an unexpected response. Check the server logs / Network tab.";
      console.error("Unexpected /api/scrape response:", data);
      return;
    }

    result.value = {
      fileNames: data.fileNames ?? selectedFileNames.value,
      fileCount: data.fileCount ?? selectedFileNames.value.length,
      totalLinksFound: data.totalLinksFound ?? data.links.length,
      links: data.links ?? [],
      grouped: data.grouped ?? { ai: [], com: [], co: [], so: [], app: [] },
      errors: data.errors ?? [],
    };
  } catch (e: any) {
    error.value =
      e?.data?.statusMessage ||
      e?.message ||
      "Something went wrong extracting links from those files.";
    console.error("Extract request failed:", e);
  } finally {
    loading.value = false;
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
    ["url", "domain", "tld", "source_file", "json_path"],
    ...result.value.links.map((l) => [
      l.url,
      l.domain,
      l.tld,
      l.sourceFile,
      l.path,
    ]),
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

// ---- Email sending ----
const emailReceiver = ref("");
const emailTitle = ref("Webapp chrillt reddit");
const emailContent = ref(
  "[i](mailto:contact@semfora.ai)heyy, are you the technical founder of renderaudit, i saw you posted about it on reddit",
);
const emailSending = ref(false);
const emailError = ref("");
const emailSuccess = ref("");

async function sendEmail() {
  emailError.value = "";
  emailSuccess.value = "";

  if (!emailReceiver.value || !emailTitle.value || !emailContent.value) {
    emailError.value = "Please fill in receiver, title, and content.";
    return;
  }

  emailSending.value = true;
  try {
    await $fetch("/api/email", {
      method: "POST",
      body: {
        to: emailReceiver.value,
        subject: emailTitle.value,
        content: emailContent.value,
      },
    });
    emailSuccess.value = "Email sent successfully.";
    emailReceiver.value = "";
    emailTitle.value = "Webapp chrillt reddit";
    emailContent.value =
      "[i](mailto:contact@semfora.ai)heyy, are you the technical founder of renderaudit, i saw you posted about it on reddit";
  } catch (e: any) {
    emailError.value =
      e?.data?.statusMessage || e?.message || "Failed to send email.";
    console.error("Send email failed:", e);
  } finally {
    emailSending.value = false;
  }
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
          Upload one or more JSON files. We'll walk every string in each and
          pull out URLs ending in
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
        multiple
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
          {{ loading ? "Extracting…" : "Choose JSON files" }}
        </button>
        <span class="text-sm text-neutral-500">
          {{
            selectedFileNames.length
              ? `${selectedFileNames.length} file${selectedFileNames.length === 1 ? "" : "s"} selected`
              : "No files selected"
          }}
        </span>
      </div>

      <p
        v-if="error"
        class="mt-4 rounded-lg bg-red-950/50 border border-red-900 text-red-300 text-sm px-4 py-3"
      >
        {{ error }}
      </p>

      <div v-if="loading" class="mt-10 text-neutral-500 text-sm">
        Parsing files and walking each JSON tree…
      </div>

      <div v-if="result && !loading" class="mt-10">
        <div
          class="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4 mb-6"
        >
          <h2 class="font-medium text-neutral-100">
            {{ result.fileCount }} file{{ result.fileCount === 1 ? "" : "s" }}
            processed
          </h2>
          <p class="text-xs text-neutral-500 mt-1">
            {{ result.totalLinksFound }} link{{
              result.totalLinksFound === 1 ? "" : "s"
            }}
            found across {{ result.fileNames.join(", ") }}
          </p>
          <p v-if="result.errors.length" class="text-xs text-amber-400 mt-2">
            Skipped: {{ result.errors.join(" · ") }}
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
              <span class="opacity-60 ml-1"> ({{ tabCount(tab.key) }}) </span>
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
              >>

              {{ link.url }}
            </a>
            <div class="mt-1 text-xs text-neutral-500 flex flex-wrap gap-x-3">
              <span class="uppercase">.{{ link.tld }}</span>
              <span class="text-neutral-600">{{ link.sourceFile }}</span>
              <span class="break-all">{{ link.path }}</span>
            </div>
          </li>
        </ul>
      </div>

      <!-- Send Email -->
      <section class="mt-16 border-t border-neutral-800 pt-10">
        <h2 class="text-xl font-semibold tracking-tight">Send an Email</h2>
        <p class="mt-2 text-neutral-400 text-sm">
          Fill in the receiver, subject, and content, then send it via Gmail
          SMTP.
        </p>

        <div class="mt-6 flex flex-col gap-4">
          <div>
            <label class="block text-xs text-neutral-500 mb-1">
              Receiver email
            </label>
            <input
              v-model="emailReceiver"
              type="email"
              placeholder="someone@example.com"
              class="w-full rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-2.5 text-sm text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-orange-600"
            />
          </div>

          <div>
            <label class="block text-xs text-neutral-500 mb-1">
              Title / Subject
            </label>
            <input
              v-model="emailTitle"
              type="text"
              placeholder="Email subject"
              class="w-full rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-2.5 text-sm text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-orange-600"
            />
          </div>

          <div>
            <label class="block text-xs text-neutral-500 mb-1"> Content </label>
            <textarea
              v-model="emailContent"
              rows="6"
              placeholder="Write your email content here…"
              class="w-full rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-2.5 text-sm text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-orange-600 resize-y"
            ></textarea>
          </div>

          <p
            v-if="emailError"
            class="rounded-lg bg-red-950/50 border border-red-900 text-red-300 text-sm px-4 py-3"
          >
            {{ emailError }}
          </p>
          <p
            v-if="emailSuccess"
            class="rounded-lg bg-emerald-950/50 border border-emerald-900 text-emerald-300 text-sm px-4 py-3"
          >
            {{ emailSuccess }}
          </p>

          <button
            type="button"
            :disabled="emailSending"
            @click="sendEmail"
            class="self-start rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed px-5 py-3 text-sm font-medium transition-colors"
          >
            {{ emailSending ? "Sending…" : "Send Email" }}
          </button>
        </div>
      </section>
    </div>
  </div>
</template>
