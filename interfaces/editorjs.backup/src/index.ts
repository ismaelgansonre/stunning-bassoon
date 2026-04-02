import { defineInterface } from '@directus/extensions-sdk';
import EditorJs from './EditorJs.vue';

export default defineInterface({
  id: 'editorjs',
  name: 'Editor.js',
  icon: 'edit',
  description: 'Block editor (Editor.js)',
  component: EditorJs,
  types: ['json', 'text'],
});
