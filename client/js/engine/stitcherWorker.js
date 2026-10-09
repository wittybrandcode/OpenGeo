/**
 * MegaTile Stitcher Web Worker (OffscreenCanvas)
 * Runs purely in the background to prevent UI freezing during heavy image stitching.
 * Returns raw ArrayBuffer memory to the main thread to avoid Node/Browser file system conflicts.
 */

self.onmessage = async function(e) {
  const {
    id, children, originalExpectedCount, expectedCells,
    startX, startY, size, gutterPixels, sourceTileSize, outputPath
  } = e.data;

  try {
    const canonicalExpected = (Array.isArray(expectedCells) ? expectedCells : []).map(String).sort();
    const inputCells = (Array.isArray(children) ? children : []).map(child =>
      `${child.x - startX},${child.y - startY}`
    ).sort();
    if (!Number.isInteger(originalExpectedCount) || originalExpectedCount < 1 ||
        children.length !== originalExpectedCount ||
        canonicalExpected.length !== originalExpectedCount ||
        new Set(canonicalExpected).size !== originalExpectedCount ||
        JSON.stringify(inputCells) !== JSON.stringify(canonicalExpected)) {
      const inputError = new Error(`MegaTile worker input coverage mismatch: ${children.length}/${originalExpectedCount || 0}.`);
      inputError.code = 'MEGATILE_WORKER_INPUT_INCOMPLETE';
      throw inputError;
    }

    const edge = Number.isInteger(gutterPixels) && gutterPixels >= 0 ? gutterPixels : 0;
    // The source image is kept at its exact content size; the extra border
    // consists only of duplicated edge texels for the later 3D sampler.
    let canvas = new OffscreenCanvas(size + (edge * 2), size + (edge * 2));
    const ctx = canvas.getContext('2d');
    
    // Load and draw all child tiles in batches to manage memory under 4K loads
    const drawResults = [];
    const batchSize = 16;
    for (let i = 0; i < children.length; i += batchSize) {
      const batch = children.slice(i, i + batchSize);
      const batchPromises = batch.map(async (child) => {
        try {
          if (!child.buffer) return { ok: false };
          
          // Create a Blob from the raw image memory (ArrayBuffer)
          // Omit the strict 'image/jpeg' type so the browser can sniff the actual format (PNG/JPG)
          const blob = new Blob([child.buffer]);
          const bitmap = await createImageBitmap(blob);
          
          const dx = ((child.x - startX) * sourceTileSize) + edge;
          const dy = ((child.y - startY) * sourceTileSize) + edge;
          
          ctx.drawImage(bitmap, dx, dy, sourceTileSize, sourceTileSize);
          
          // Explicitly close the bitmap to free memory immediately
          bitmap.close();
          return { ok: true, x: child.x - startX, y: child.y - startY };
        } catch (err) {
          console.warn(`[Worker] Failed to decode tile: ${err}`);
          return { ok: false };
        }
      });
      const batchResults = await Promise.all(batchPromises);
      drawResults.push(...batchResults);
    }
    const decoded = drawResults.filter(result => result && result.ok);
    const decodedCells = decoded.map(result => `${result.x},${result.y}`).sort();
    if (decoded.length !== originalExpectedCount ||
        JSON.stringify(decodedCells) !== JSON.stringify(canonicalExpected)) {
      const decodeError = new Error(`MegaTile worker decoded ${decoded.length}/${originalExpectedCount} expected cells.`);
      decodeError.code = 'MEGATILE_WORKER_DECODE_INCOMPLETE';
      throw decodeError;
    }

    extrudeCanvasGutter(ctx, size, edge);

    // Export the canvas to a PNG Blob
    const finalBlob = await canvas.convertToBlob({ type: 'image/png' });
    
    // Extract raw memory (ArrayBuffer)
    const arrayBuffer = await finalBlob.arrayBuffer();

    // Explicitly release the GPU backing store for this MegaTile in Chromium/CEP
    canvas.width = 0;
    canvas.height = 0;
    canvas = null;

    // Send the memory back to the main thread (Transferable Object)
    // The second argument [arrayBuffer] transfers ownership, making it O(1) speed and preventing leaks
    self.postMessage({
      id: id,
      status: 'success',
      outputPath: outputPath,
      buffer: arrayBuffer,
      decodedCount: decoded.length,
      originalExpectedCount: originalExpectedCount,
      expectedCells: canonicalExpected,
      decodedCells: decodedCells,
      coverageMask: decodedCells
    }, [arrayBuffer]);

  } catch (error) {
    if (typeof canvas !== 'undefined' && canvas) {
      try {
        canvas.width = 0;
        canvas.height = 0;
      } catch (_e) {
        /* worker canvas cleanup fallback */
      }
      canvas = null;
    }
    self.postMessage({
      id: id,
      status: 'error',
      outputPath: outputPath,
      code: error.code || 'MEGATILE_WORKER_FAILED',
      error: error.message || error.toString()
    });
  }
};

function extrudeCanvasGutter(ctx, contentSize, gutterPixels) {
  if (!gutterPixels) return;
  const right = gutterPixels + contentSize - 1;
  const bottom = gutterPixels + contentSize - 1;
  const topRow = ctx.getImageData(gutterPixels, gutterPixels, contentSize, 1);
  const bottomRow = ctx.getImageData(gutterPixels, bottom, contentSize, 1);
  const leftColumn = ctx.getImageData(gutterPixels, gutterPixels, 1, contentSize);
  const rightColumn = ctx.getImageData(right, gutterPixels, 1, contentSize);
  const topLeft = ctx.getImageData(gutterPixels, gutterPixels, 1, 1);
  const topRight = ctx.getImageData(right, gutterPixels, 1, 1);
  const bottomLeft = ctx.getImageData(gutterPixels, bottom, 1, 1);
  const bottomRight = ctx.getImageData(right, bottom, 1, 1);
  for (let pixel = 0; pixel < gutterPixels; pixel++) {
    ctx.putImageData(topRow, gutterPixels, pixel);
    ctx.putImageData(bottomRow, gutterPixels, bottom + 1 + pixel);
    ctx.putImageData(leftColumn, pixel, gutterPixels);
    ctx.putImageData(rightColumn, right + 1 + pixel, gutterPixels);
    for (let corner = 0; corner < gutterPixels; corner++) {
      ctx.putImageData(topLeft, corner, pixel);
      ctx.putImageData(topRight, right + 1 + corner, pixel);
      ctx.putImageData(bottomLeft, corner, bottom + 1 + pixel);
      ctx.putImageData(bottomRight, right + 1 + corner, bottom + 1 + pixel);
    }
  }
}
