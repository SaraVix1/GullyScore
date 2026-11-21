<script>
  import { encodeQR, qrPath } from '../lib/qr.js';

  let { text } = $props();
  const qr = $derived(encodeQR(text));
</script>

<svg class="qr" viewBox="0 0 {qr.size + 8} {qr.size + 8}" shape-rendering="crispEdges" role="img" aria-label="Connection QR code">
  <rect width="100%" height="100%" fill="#fff" />
  <path d={qrPath(qr)} fill="#000" />
</svg>

<style>
  .qr {
    display: block;
    width: min(100%, 340px);
    margin: 0 auto;
    border-radius: var(--radius);
  }
</style>
