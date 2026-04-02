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
  
  let parsed: any = value;
  
  // Si c'est une string, parser en JSON
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  
  // Valider qu'on a une structure Editor.js valide
  if (!parsed || typeof parsed !== 'object') return undefined;
  if (!Array.isArray(parsed.blocks) || parsed.blocks.length === 0) {
    return undefined;
  }
  
  // Filter out invalid blocks mais garder la structure complète
  const validBlocks = parsed.blocks.filter((block: any) => {
    if (!block || typeof block !== 'object' || !block.type || !block.data) {
      console.warn('❌ Block missing required fields:', block);
      return false;
    }
    
    // Juste vérifier que le block a un type et data, pas plus strict
    return true;
  }).map((block: any) => {
    // IMPORTANT: Enlever les IDs générés par Editor.js (c'est pas du contenu à persister)
    const { id, ...blockWithoutId } = block;
    return blockWithoutId;
  });
  
  if (validBlocks.length === 0) {
    console.warn('⚠️ All blocks were invalid');
    return undefined;
  }
  
  const result = {
    version: parsed.version || 2.31,
    blocks: validBlocks,
    // N'inclure time que si c'était déjà présent (pour les données historiques)
    ...(parsed.time && { time: parsed.time }),
  };
  
  console.log('✔️ Cleaned value (will send to Directus):', JSON.stringify(result, null, 2));
  return result as OutputData;
};

const toggleMode = async () => {
  try {
    if (isEditMode.value && editor) {
      // Save and switch to view mode
      const data = await editor.save();
      const validated = parseValue(data);
      
      if (!validated) {
        console.error('Failed to save: invalid editor data', data);
        return;
      }
      
      // Emit the validated data before switching mode
      const serialized = JSON.stringify(validated);
      lastSaved = serialized;
      emit('update:modelValue', validated);
      
      isEditMode.value = false;
      
      // Initialize viewer after mode switch
      await new Promise(resolve => setTimeout(resolve, 100));
      await initViewerEditor(validated);
    } else {
      // Switch back to edit mode
      if (viewerEditor) {
        await viewerEditor.destroy();
        viewerEditor = null;
      }
      isEditMode.value = true;
    }
  } catch (error) {
    console.error('Mode toggle error:', error);
  }
};

const initViewerEditor = async (data: OutputData) => {
  if (!viewerHolder.value) {
    console.warn('Viewer holder not available');
    return;
  }

  if (viewerEditor) {
    await viewerEditor.destroy();
  }

  try {
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
    console.log('Viewer initialized successfully');
  } catch (error) {
    console.error('Failed to initialize viewer:', error);
  }
};

onMounted(async () => {
  if (!holder.value) {
    console.error('❌ Holder element not found');
    return;
  }

  const parsedData = parseValue(props.modelValue);
  console.log('🚀 Mounting Editor.js with data:', parsedData);

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
      try {
        const data = await editor.save();
        console.log('Editor changed, data:', data);
        
        // Valider que les données après save sont correctes
        const validated = parseValue(data);
        if (!validated) {
          console.warn('⚠️ Editor.js saved but validation failed:', data);
          return;
        }
        
        const serialized = JSON.stringify(validated);
        if (serialized === lastSaved) {
          console.log('✓ Data unchanged, skipping emit');
          return;
        }
        
        console.log('💾 Emitting validated data:', validated);
        lastSaved = serialized;
        emit('update:modelValue', validated);
      } catch (error) {
        console.error('❌ Error in onChange:', error);
      }
    },
  });

  await editor.isReady;
  ready = true;
  console.log('✅ Editor.js ready and mounted');

  pasteHandler = async (event: ClipboardEvent) => {
    if (!editor || !ready) return;
    const items = event.clipboardData?.items || [];
    const imageItem = Array.from(items).find((item) => item.type.startsWith('image/'));
    if (!imageItem) return;

    event.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;

    try {
      console.log('📸 Image pasted, uploading:', file.name);
      const formData = new FormData();
      formData.append('file', file);

      const response = await api.post('/files', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      const id = response?.data?.data?.id;
      if (!id) {
        console.warn('❌ File upload returned no ID');
        return;
      }

      const url = `${getBaseUrl()}/assets/${id}`;
      console.log('✅ Image uploaded:', url);
      await editor.blocks.insert('image', { file: { url } }, {}, undefined, true);
    } catch (error) {
      console.error('❌ Image upload failed:', error);
    }
  };

  holder.value?.addEventListener('paste', pasteHandler);
});

watch(
  () => props.modelValue,
  async (next) => {
    if (!editor || !ready) return;
    console.log('👁️ Props modelValue changed:', next);
    
    const parsed = parseValue(next);
    const serialized = parsed ? JSON.stringify(parsed) : null;
    if (serialized && serialized === lastSaved) {
      console.log('✓ Props sync skipped (same data)');
      return;
    }

    if (parsed) {
      console.log('🔄 Rendering new data in editor');
      await editor.render(parsed);
    } else {
      console.log('🧹 Clearing editor');
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
