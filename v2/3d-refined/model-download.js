// Bounded range requests keep large models recoverable on slow connections.
// A server without Range support is handled as a normal streaming response.
const PART_BYTES = 2 * 1024 * 1024;
const EXPECTED_SHA256 = '1740cd0746415f8bf7aa3a27c04be6695ee9104e768d08aaffa2b734d85d8f21';
const controllers = new Set();

async function request(url, start, end) {
  let failure;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 60000);
    let streamOwned = false;
    try {
      const response = await fetch(url, {
        headers: { Range: `bytes=${start}-${end}` },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Model download HTTP ' + response.status);
      if (response.status === 200 && start === 0) {
        // Keep the timeout and controller alive until this stream is consumed.
        streamOwned = true;
        return { response, finish: () => { clearTimeout(timer); controllers.delete(controller); } };
      }
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
      if (response.status !== 206 || !range || Number(range[1]) !== start || Number(range[2]) !== Math.min(end, Number(range[3]) - 1)) {
        throw new Error('Server returned an unexpected model range');
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length !== Number(range[2]) - start + 1) throw new Error('Incomplete model range');
      return { bytes, total: Number(range[3]), etag: response.headers.get('etag') };
    } catch (error) {
      failure = error;
    } finally {
      if (!streamOwned) {
        clearTimeout(timer);
        controllers.delete(controller);
      }
    }
  }
  throw failure;
}

export async function downloadModel(url, onProgress) {
  const update = (loaded, total) => onProgress({ loaded, total, lengthComputable: total > 0 });
  try {
    const first = await request(url, 0, PART_BYTES - 1);
    let data;
    if (first.response) {
      try {
        const total = Number(first.response.headers.get('content-length')) || 0;
        const reader = first.response.body.getReader();
        const parts = [];
        let loaded = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          loaded += value.length; parts.push(value); update(loaded, total);
        }
        if (total && loaded !== total) throw new Error('Incomplete model download');
        data = new Uint8Array(loaded);
        let offset = 0;
        for (const part of parts) { data.set(part, offset); offset += part.length; }
      } finally { first.finish(); }
    } else {
      const total = first.total;
      data = new Uint8Array(total); data.set(first.bytes, 0);
      let loaded = first.bytes.length, next = first.bytes.length;
      update(loaded, total);
      async function worker() {
        while (next < total) {
          const start = next; next += PART_BYTES;
          const result = await request(url, start, Math.min(total - 1, start + PART_BYTES - 1));
          if (result.total !== total || (first.etag && result.etag && first.etag !== result.etag)) throw new Error('Model changed while downloading');
          data.set(result.bytes, start); loaded += result.bytes.length; update(loaded, total);
        }
      }
      await Promise.all([worker(), worker()]);
    }
    if (crypto.subtle) {
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
      const actual = Array.from(hash, value => value.toString(16).padStart(2, '0')).join('');
      if (actual !== EXPECTED_SHA256) throw new Error('Model integrity check failed');
    }
    update(data.length, data.length);
    return data.buffer;
  } finally {
    for (const controller of controllers) controller.abort();
    controllers.clear();
  }
}
