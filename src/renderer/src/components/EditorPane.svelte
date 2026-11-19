<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { createEditor, type EditorHandle, type FormatKind } from '../lib/editor'

  interface Props {
    onChange: () => void
    onSave: () => void
    onReady: (handle: EditorHandle) => void
  }

  let { onChange, onSave, onReady }: Props = $props()

  let hostEl: HTMLDivElement
  let handle: EditorHandle | null = null

  onMount(() => {
    handle = createEditor(hostEl, {
      onChange,
      onSave,
      onScrollTop: () => {}
    })
    onReady(handle)
    return () => {
      handle?.destroy()
      handle = null
    }
  })

  /* 供父组件在切换文档时聚焦 */
  export function focus(): void {
    handle?.focus()
  }

  export function format(kind: FormatKind): void {
    handle?.format(kind)
  }
</script>

<div class="editor-host" bind:this={hostEl}></div>

<style>
  .editor-host {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
</style>
