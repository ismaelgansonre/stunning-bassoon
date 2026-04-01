<template>
  <div class="editorjs-wrapper">
    <div class="editorjs-toolbar">
      <button
        type="button"
        class="editorjs-toggle"
        :class="{ active: showPreview }"
        @click="showPreview = !showPreview"
      >
        {{ showPreview ? 'Hide Preview' : 'Show Preview' }}
      </button>
    </div>

    <div class="editorjs-grid" :class="{ split: showPreview }">
      <div ref="holder" class="editorjs-holder"></div>

      <div v-if="showPreview" class="editorjs-preview" v-html="previewHtml"></div>
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
let editor: EditorJS | null = null;
let ready = false;
let lastSaved: string | null = null;
const showPreview = ref(true);
const previewHtml = ref('');
const api = useApi();
const parser = edjsHTML();
let pasteHandler: ((event: ClipboardEvent) => void) | null = null;

const getBaseUrl = () => {
  const base = api?.defaults?.baseURL || window.location.origin;
  return base.replace(/\/$/, '');
};

const updatePreview = (data: OutputData | undefined) => {
  if (!data) {
    previewHtml.value = '';
    return;
  }
  try {
    const chunks = parser.parse(data) as string[];
    previewHtml.value = chunks.join('');
  } catch {
    previewHtml.value = '';
  }
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

onMounted(async () => {
  if (!holder.value) return;

  editor = new EditorJS({
    holder: holder.value,
    readOnly: !!props.readOnly,
    autofocus: true,
    data: parseValue(props.modelValue),
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
      updatePreview(data);
      emit('update:modelValue', data);
    },
  });

  await editor.isReady;
  updatePreview(parseValue(props.modelValue));
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
      updatePreview(parsed);
    } else {
      await editor.clear();
      updatePreview(undefined);
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
});
</script>

<style scoped>
.editorjs-wrapper {
  min-height: 200px;
}

.editorjs-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 12px;
}

.editorjs-toggle {
  border: 1px solid var(--theme--border-color, #2a2a2a);
  background: var(--theme--background-normal, #151515);
  color: var(--theme--foreground, #ffffff);
  padding: 6px 10px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

.editorjs-toggle.active {
  border-color: var(--theme--primary, #3b82f6);
  color: var(--theme--primary, #3b82f6);
}

.editorjs-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}

.editorjs-grid.split {
  grid-template-columns: 1fr 1fr;
}

.editorjs-preview {
  border: 1px solid var(--theme--border-color, #2a2a2a);
  background: var(--theme--background-subdued, #101010);
  padding: 16px;
  overflow: auto;
}

.editorjs-holder :deep(.ce-block__content),
.editorjs-holder :deep(.ce-toolbar__content) {
  max-width: 100%;
}
</style>
