<template>
  <div class="editorjs-wrapper">
    <div class="editorjs-toolbar">
      <button
        type="button"
        class="editorjs-toggle"
        :class="{ active: isEditMode }"
        @click="toggleMode"
      >
        {{ isEditMode ? '✏️ Edit Mode' : '👁️ View Mode' }}
      </button>
    </div>

    <!-- Edit Mode -->
    <div v-if="isEditMode" class="editorjs-container">
      <div ref="holder" class="editorjs-holder"></div>
    </div>

    <!-- View Mode (Read-Only) -->
    <div v-else class="editorjs-container">
      <div ref="viewerHolder" class="editorjs-viewer"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import EditorJS from '@editorjs/editorjs';
import type { OutputData } from '@editorjs/editorjs';
import Header from '@editorjs/header';
import ImageTool from '@editorjs/image';
import List from '@editorjs/list';
import Quote from '@editorjs/quote';
import Code from '@editorjs/code';
import edjsHTML from 'editorjs-html';
import { useApi } from '@directus/extensions-sdk';

const props = defineProps<{ modelValue?: OutputData | string | null; readOnly?: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: OutputData | null): void }>();

const holder = ref<HTMLDivElement | null>(null);
const viewerHolder = ref<HTMLDivElement | null>(null);
let editor: EditorJS | null = null;
let viewerEditor: EditorJS | null = null;
let ready = false;
let lastSaved: string | null = null;
const isEditMode = ref(true);
const api = useApi();
let pasteHandler: ((event: ClipboardEvent) => void) | null = null;

const getBaseUrl = () => {
  const base = api?.defaults?.baseURL || window.location.origin;
  return base.replace(/\/$/, '');
};

// Custom heading renderer
const customHeadingRenderer = (block: any) => {
  const { level, text } = block.data;
  const tag = `h${level}`;
  return `<${tag}>${text}</${tag}>`;
};

// Custom parser with heading fix
const getParser = () => {
  const parser = edjsHTML({
    paragraph: (block: any) => `<p>${block.data.text}</p>`,
    heading: customHeadingRenderer,
    image: (block: any) => {
      const { url, caption } = block.data.file || block.data;
      return `<figure><img src="${url}" alt="${caption || ''}" />${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`;
    },
    list: (block: any) => {
      const { items, style } = block.data;
      const tag = style === 'unordered' ? 'ul' : 'ol';
      const itemsHTML = items.map((item: string) => `<li>${item}</li>`).join('');
      return `<${tag}>${itemsHTML}</${tag}>`;
    },
    quote: (block: any) => {
      const { text, caption } = block.data;
      return `<blockquote><p>${text}</p>${caption ? `<footer>${caption}</footer>` : ''}</blockquote>`;
    },
    code: (block: any) => {
      const { code } = block.data;
      return `<pre><code>${code}</code></pre>`;
    },
  });
  return parser;
};

const parseValue = (value: OutputData | string | null | undefined): OutputData | undefined => {
  if (!value) return undefined;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as OutputData;
    } catch {
      return undefined;
    }
  }
  return value;
};

const toggleMode = async () => {
  if (isEditMode.value && editor) {
    // Switch to view mode: save editor data
    const data = await editor.save();
    isEditMode.value = false;
    await initViewerEditor(data);
  } else {
    // Switch to edit mode
    if (viewerEditor) {
      await viewerEditor.destroy();
      viewerEditor = null;
    }
    isEditMode.value = true;
  }
};

const initViewerEditor = async (data: OutputData) => {
  if (!viewerHolder.value) return;

  if (viewerEditor) {
    await viewerEditor.destroy();
  }

  viewerEditor = new EditorJS({
    holder: viewerHolder.value,
    readOnly: true,
    data,
    tools: {
      header: Header,
      image: ImageTool,
      list: List,
      quote: Quote,
      code: Code,
    },
  });

  await viewerEditor.isReady;
};

onMounted(async () => {
  if (!holder.value) return;

  const parsedData = parseValue(props.modelValue);

  editor = new EditorJS({
    holder: holder.value,
    readOnly: !!props.readOnly,
    autofocus: true,
    data: parsedData,
    tools: {
      header: {
        class: Header,
        inlineToolbar: true,
        config: {
          levels: [1, 2, 3, 4],
          defaultLevel: 2,
        },
      },
      image: {
        class: ImageTool,
        config: {
          uploader: {
            uploadByFile: async (file: File) => {
              const formData = new FormData();
              formData.append('file', file);

              const response = await api.post('/files', formData, {
                headers: {
                  'Content-Type': 'multipart/form-data',
                },
              });

              const id = response?.data?.data?.id;
              if (!id) {
                return { success: 0 };
              }

              const url = `${getBaseUrl()}/assets/${id}`;
              return {
                success: 1,
                file: {
                  url,
                },
              };
            },
          },
        },
      },
      list: {
        class: List,
        inlineToolbar: true,
      },
      quote: {
        class: Quote,
        inlineToolbar: true,
        config: {
          quotePlaceholder: 'Citation',
          captionPlaceholder: 'Auteur',
        },
      },
      code: {
        class: Code,
      },
    },
    onChange: async () => {
      if (!editor) return;
      const data = await editor.save();
      const serialized = JSON.stringify(data);
      if (serialized === lastSaved) return;
      lastSaved = serialized;
      emit('update:modelValue', data);
    },
  });

  await editor.isReady;
  ready = true;

  pasteHandler = async (event: ClipboardEvent) => {
    if (!editor || !ready) return;
    const items = event.clipboardData?.items || [];
    const imageItem = Array.from(items).find((item) => item.type.startsWith('image/'));
    if (!imageItem) return;

    event.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await api.post('/files', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      const id = response?.data?.data?.id;
      if (!id) return;

      const url = `${getBaseUrl()}/assets/${id}`;
      await editor.blocks.insert('image', { file: { url } }, {}, undefined, true);
    } catch {
      // Ignore paste failures to avoid breaking normal typing.
    }
  };

  holder.value?.addEventListener('paste', pasteHandler);
});

watch(
  () => props.modelValue,
  async (next) => {
    if (!editor || !ready) return;
    const parsed = parseValue(next);
    const serialized = parsed ? JSON.stringify(parsed) : null;
    if (serialized && serialized === lastSaved) return;

    if (parsed) {
      await editor.render(parsed);
    } else {
      await editor.clear();
    }
  }
);

onBeforeUnmount(async () => {
  if (holder.value && pasteHandler) {
    holder.value.removeEventListener('paste', pasteHandler);
  }
  pasteHandler = null;
  if (editor) {
    await editor.destroy();
    editor = null;
  }
  if (viewerEditor) {
    await viewerEditor.destroy();
    viewerEditor = null;
  }
});
</script>

<style scoped>
.editorjs-wrapper {
  min-height: 400px;
}

.editorjs-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 16px;
}

.editorjs-toggle {
  border: 1px solid var(--theme--border-color, #2a2a2a);
  background: var(--theme--background-normal, #151515);
  color: var(--theme--foreground, #ffffff);
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 500;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.editorjs-toggle:hover {
  border-color: var(--theme--primary, #3b82f6);
  background: var(--theme--background-subdued, #1a1a1a);
}

.editorjs-toggle.active {
  border-color: var(--theme--primary, #3b82f6);
  background: var(--theme--primary, #3b82f6);
  color: white;
}

.editorjs-container {
  width: 100%;
  min-height: 300px;
}

.editorjs-holder {
  border: 1px solid var(--theme--border-color, #2a2a2a);
  background: var(--theme--background-normal, #151515);
  padding: 16px;
  border-radius: 4px;
  min-height: 300px;
}

.editorjs-viewer {
  border: 1px solid var(--theme--border-color, #2a2a2a);
  background: var(--theme--background-normal, #151515);
  padding: 24px;
  border-radius: 4px;
  min-height: 300px;
  line-height: 1.6;
}

/* Editor.js styles */
.editorjs-holder :deep(.ce-block__content),
.editorjs-holder :deep(.ce-toolbar__content) {
  max-width: 100%;
}

/* Heading styles in viewer */
.editorjs-viewer :deep(h1) {
  font-size: 2em;
  font-weight: 700;
  margin: 0.67em 0;
  color: var(--theme--foreground, #ffffff);
}

.editorjs-viewer :deep(h2) {
  font-size: 1.5em;
  font-weight: 700;
  margin: 0.75em 0;
  color: var(--theme--foreground, #ffffff);
}

.editorjs-viewer :deep(h3) {
  font-size: 1.17em;
  font-weight: 700;
  margin: 0.83em 0;
  color: var(--theme--foreground, #ffffff);
}

.editorjs-viewer :deep(h4) {
  font-size: 1em;
  font-weight: 700;
  margin: 1em 0;
  color: var(--theme--foreground, #ffffff);
}

.editorjs-viewer :deep(p) {
  margin: 1em 0;
  color: var(--theme--foreground, #ffffff);
}

.editorjs-viewer :deep(ul),
.editorjs-viewer :deep(ol) {
  margin: 1em 0;
  padding-left: 2em;
  color: var(--theme--foreground, #ffffff);
}

.editorjs-viewer :deep(li) {
  margin: 0.5em 0;
}

.editorjs-viewer :deep(blockquote) {
  border-left: 4px solid var(--theme--primary, #3b82f6);
  padding-left: 16px;
  margin: 1em 0;
  font-style: italic;
  color: var(--theme--foreground-subdued, #a0a0a0);
}

.editorjs-viewer :deep(blockquote footer) {
  font-size: 0.9em;
  margin-top: 0.5em;
  color: var(--theme--foreground-subdued, #a0a0a0);
  font-style: normal;
}

.editorjs-viewer :deep(pre) {
  background: var(--theme--background-subdued, #101010);
  border: 1px solid var(--theme--border-color, #2a2a2a);
  padding: 12px;
  border-radius: 4px;
  overflow-x: auto;
  margin: 1em 0;
}

.editorjs-viewer :deep(code) {
  font-family: 'Courier New', monospace;
  font-size: 0.9em;
  color: var(--theme--foreground, #ffffff);
}

.editorjs-viewer :deep(figure) {
  margin: 1.5em 0;
  text-align: center;
}

.editorjs-viewer :deep(figure img) {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
  border: 1px solid var(--theme--border-color, #2a2a2a);
}

.editorjs-viewer :deep(figcaption) {
  font-size: 0.9em;
  color: var(--theme--foreground-subdued, #a0a0a0);
  margin-top: 8px;
  font-style: italic;
}
</style>
