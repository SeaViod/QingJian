<script lang="ts">
  /**
   * 内联图标集：不引第三方图标库，省体积也省得风格不统一。
   * 全部 24×24 网格、1.8px 描边、currentColor。
   */
  const PATHS: Record<string, string> = {
    bold: 'M7 5h6a4 4 0 0 1 0 8H7zM7 13h7a4 4 0 0 1 0 8H7z',
    italic: 'M10 5h8M6 19h8M14 5l-4 14',
    strike: 'M5 12h14M9.5 7.2A2.8 2.8 0 0 1 12.3 5c1.9 0 3.4 1.1 3.8 2.6M14.5 16.8A2.8 2.8 0 0 1 11.7 19c-1.9 0-3.4-1.1-3.8-2.6',
    heading: 'M6 5v14M18 5v14M6 12h12',
    quote: 'M9.5 8H5v4.2h2.3c0 2.1-1 3.4-2.3 4.3M19 8h-4.5v4.2h2.3c0 2.1-1 3.4-2.3 4.3',
    ul: 'M9 6h11M9 12h11M9 18h11M5 6h.01M5 12h.01M5 18h.01',
    ol: 'M10 6h10M10 12h10M10 18h10M4 5h1.4v4M4 12h2l-2 2.2h2M4 17.4h2v2H4z',
    task: 'M4 5.5h4.5v4.5H4zM4 14h4.5v4.5H4zM11.5 8h9M11.5 16.2h9',
    link: 'M10.5 13.5a3.8 3.8 0 0 0 5.6.4l2-2a3.9 3.9 0 0 0-5.5-5.5l-1.1 1.1M13.5 10.5a3.8 3.8 0 0 0-5.6-.4l-2 2a3.9 3.9 0 0 0 5.5 5.5l1.1-1.1',
    image: 'M4 5h16v14H4zM4 16.5l4.2-4.2 3 3 3.3-3.3L20 17M8.6 9.2h.01',
    code: 'M9.5 7.5 4.8 12l4.7 4.5M14.5 7.5 19.2 12l-4.7 4.5',
    table: 'M4 5h16v14H4zM4 10h16M10 5v14',
    hr: 'M5 12h14M8 8h8M8 16h8',
    sun: 'M12 4.5v2M12 17.5v2M4.5 12h2M17.5 12h2M6.7 6.7l1.4 1.4M15.9 15.9l1.4 1.4M17.3 6.7l-1.4 1.4M8.1 15.9l-1.4 1.4M12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2z',
    moon: 'M20 13.8A8 8 0 0 1 10.2 4 8.2 8.2 0 1 0 20 13.8z',
    soundOn: 'M5 9.2v5.6h3.4L13 19V5L8.4 9.2H5zM16.4 8.4a5.2 5.2 0 0 1 0 7.2',
    soundOff: 'M5 9.2v5.6h3.4L13 19V5L8.4 9.2H5zM16.6 9.6l4 4.8M20.6 9.6l-4 4.8',
    folder: 'M4 6.5h5.6l1.8 2H20v10H4z',
    refresh: 'M20 5.6v4.8h-4.8M4 18.4v-4.8h4.8M18.9 10.4A7 7 0 0 0 6.4 7.4M5.1 13.6a7 7 0 0 0 12.5 3',
    check: 'M5 12.5l4.4 4.4L19 6.5',
    open: 'M14 4h6v6M20 4l-8.5 8.5M18 14v5.5H4.5V6H10'
  }

  interface Props {
    name: keyof typeof PATHS | string
    size?: number
    strokeWidth?: number
  }

  let { name, size = 17, strokeWidth = 1.8 }: Props = $props()
  const d = $derived(PATHS[name] ?? '')
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={strokeWidth}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
>
  <path d={d} />
</svg>
