<script>
  // Camera QR scanner. Uses the built-in BarcodeDetector where it exists
  // (Android Chrome) and our own decoder elsewhere (iPhone Safari).
  import { decodeQR } from '../lib/qr.js';

  let { onresult } = $props();

  let video;
  let error = $state('');
  let pasting = $state(false);
  let pasted = $state('');

  $effect(() => {
    let stream;
    let stopped = false;
    let timer;
    let detector = null;
    try {
      if ('BarcodeDetector' in window) detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    } catch {
      detector = null;
    }
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    async function frame() {
      if (stopped) return;
      let text = null;
      if (video.readyState >= 2 && video.videoWidth) {
        if (detector) {
          try {
            text = (await detector.detect(video))[0]?.rawValue || null;
          } catch {
            detector = null;
          }
        }
        if (!text) {
          const k = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
          canvas.width = Math.round(video.videoWidth * k);
          canvas.height = Math.round(video.videoHeight * k);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          text = decodeQR(ctx.getImageData(0, 0, canvas.width, canvas.height));
        }
      }
      if (text && /^GS1/i.test(text.trim())) {
        navigator.vibrate?.(30);
        return onresult(text.trim());
      }
      timer = setTimeout(frame, 100);
    }

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        video.srcObject = stream;
        await video.play();
        frame();
      } catch {
        error = 'Camera not available. Allow camera access, or paste the code instead.';
        pasting = true;
      }
    })();

    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  });
</script>

<div class="scanner">
  <!-- svelte-ignore a11y_media_has_caption -->
  <video bind:this={video} playsinline muted autoplay></video>
  <div class="frame" aria-hidden="true"></div>
</div>
{#if error}<p class="error">{error}</p>{/if}
{#if pasting}
  <textarea class="paste" rows="3" placeholder="Paste the code (starts with GS1)" bind:value={pasted}></textarea>
  <button class="btn primary block" disabled={!/GS1/i.test(pasted)} onclick={() => onresult(pasted.trim())}>Use this code</button>
{:else}
  <button class="link" onclick={() => (pasting = true)}>Can't scan? Paste the code instead</button>
{/if}

<style>
  .scanner {
    position: relative;
    width: min(100%, 340px);
    aspect-ratio: 1;
    margin: 0 auto;
    border-radius: var(--radius);
    overflow: hidden;
    background: #000;
  }

  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .frame {
    position: absolute;
    inset: 12%;
    border: 3px solid var(--accent);
    border-radius: var(--radius);
    box-shadow: 0 0 0 999px rgba(0, 0, 0, 0.35);
  }

  .error {
    color: var(--amber);
    font-weight: 700;
    margin: 10px 0;
  }

  .paste {
    width: 100%;
    margin: 10px 0 8px;
    padding: 10px;
    border-radius: var(--radius);
    border: 2px solid var(--line);
    background: var(--surface-2);
    font: 600 14px/1.3 ui-monospace, monospace;
    word-break: break-all;
  }

  .link {
    display: block;
    margin: 10px auto 0;
    min-height: 44px;
    color: var(--muted);
    text-decoration: underline;
  }
</style>
