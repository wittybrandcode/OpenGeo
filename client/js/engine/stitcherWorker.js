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
    
    // Decode all child bitmaps in batches first, then perform a strict 2-pass draw:
    // Pass 1: Draw 1px expanded underlay ONLY so no subsequent tile ever overwrites
    //         a previously drawn neighbor's native 1:1 edge texels.
    // Pass 2: Draw exact 1:1 native tiles at integer coordinates [dx, dy].
    const decodedItems = [];
    const batchSize = 16;
    for (let i = 0; i < children.length; i += batchSize) {
      const batch = children.slice(i, i + batchSize);
      const batchPromises = batch.map(async (child) => {
        try {
          if (!child.buffer) return { ok: false };
          const blob = new Blob([child.buffer]);
          const bitmap = await createImageBitmap(blob);
          return {
            ok: true,
            cellX: child.x - startX,
            cellY: child.y - startY,
            bitmap
          };
        } catch (err) {
          console.warn(`[Worker] Failed to decode tile: ${err}`);
          return { ok: false };
        }
      });
      const batchResults = await Promise.all(batchPromises);
      decodedItems.push(...batchResults);
    }

    const decoded = decodedItems.filter(item => item && item.ok && item.bitmap);
    const decodedCells = decoded.map(item => `${item.cellX},${item.cellY}`).sort();
    if (decoded.length !== originalExpectedCount ||
        JSON.stringify(decodedCells) !== JSON.stringify(canonicalExpected)) {
      for (const item of decoded) {
        try { item.bitmap.close(); } catch (_e) {}
      }
      const decodeError = new Error(`MegaTile worker decoded ${decoded.length}/${originalExpectedCount} expected cells.`);
      decodeError.code = 'MEGATILE_WORKER_DECODE_INCOMPLETE';
      throw decodeError;
    }

    // PASS 1: Underlay seal (only visible in empty neighbor cells)
    for (const item of decoded) {
      const dx = (item.cellX * sourceTileSize) + edge;
      const dy = (item.cellY * sourceTileSize) + edge;
      ctx.drawImage(item.bitmap, dx - 1, dy - 1, sourceTileSize + 2, sourceTileSize + 2);
    }

    // PASS 2: Exact 1:1 integer pixel placement (100% native sharpness, zero neighbor overwrite)
    const occupiedSet = new Set(decodedCells);
    for (const item of decoded) {
      const dx = (item.cellX * sourceTileSize) + edge;
      const dy = (item.cellY * sourceTileSize) + edge;
      ctx.drawImage(item.bitmap, dx, dy, sourceTileSize, sourceTileSize);
      item.bitmap.close();
    }

    // Seal internal cell borders that face unoccupied cells inside sparse MegaTiles
    extrudeInternalCellEdges(ctx, decoded, occupiedSet, sourceTileSize, edge);
    // Seal outer perimeter of the canvas
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

function extrudeInternalCellEdges(ctx, validItems, occupiedSet, sourceTileSize, gutterPixels) {
  if (!ctx || typeof ctx.getImageData !== 'function' || typeof ctx.putImageData !== 'function') return;
  const pad = Math.max(1, gutterPixels || 1);
  for (const item of validItems) {
    const cx = item.cellX;
    const cy = item.cellY;
    const dx = (cx * sourceTileSize) + gutterPixels;
    const dy = (cy * sourceTileSize) + gutterPixels;

    // Top neighbor empty -> extrude top row upward by 1px
    if (!occupiedSet.has(`${cx},${cy - 1}`) && dy - 1 >= 0) {
      const topRow = ctx.getImageData(dx, dy, sourceTileSize, 1);
      ctx.putImageData(topRow, dx, dy - 1);
    }
    // Bottom neighbor empty -> extrude bottom row downward by 1px
    if (!occupiedSet.has(`${cx},${cy + 1}`)) {
      const bottomRow = ctx.getImageData(dx, dy + sourceTileSize - 1, sourceTileSize, 1);
      ctx.putImageData(bottomRow, dx, dy + sourceTileSize);
    }
    // Left neighbor empty -> extrude left column leftward by 1px
    if (!occupiedSet.has(`${cx - 1},${cy}`) && dx - 1 >= 0) {
      const leftCol = ctx.getImageData(dx, dy, 1, sourceTileSize);
      ctx.putImageData(leftCol, dx - 1, dy);
    }
    // Right neighbor empty -> extrude right column rightward by 1px
    if (!occupiedSet.has(`${cx + 1},${cy}`)) {
      const rightCol = ctx.getImageData(dx + sourceTileSize - 1, dy, 1, sourceTileSize);
      ctx.putImageData(rightCol, dx + sourceTileSize, dy);
    }
  }
}

function extrudeCanvasGutter(ctx, contentSize, gutterPixels) {
  if (!gutterPixels) return;
  if (!ctx || typeof ctx.getImageData !== 'function' || typeof ctx.putImageData !== 'function') return;
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
