/**
 * MegaTile Stitcher Web Worker (OffscreenCanvas)
 * Runs purely in the background to prevent UI freezing during heavy image stitching.
 * Returns raw ArrayBuffer memory to the main thread to avoid Node/Browser file system conflicts.
 */

self.onmessage = async function(e) {
  const {
    id, children, originalExpectedCount, expectedCells,
    startX, startY, size, sourceTileSize, outputPath
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

    // Initialize OffscreenCanvas
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    
    // Load and draw all child tiles
    const drawPromises = children.map(async (child) => {
      try {
        if (!child.buffer) return { ok: false };
        
        // Create a Blob from the raw image memory (ArrayBuffer)
        // Omit the strict 'image/jpeg' type so the browser can sniff the actual format (PNG/JPG)
        const blob = new Blob([child.buffer]);
        const bitmap = await createImageBitmap(blob);
        
        const dx = (child.x - startX) * sourceTileSize;
        const dy = (child.y - startY) * sourceTileSize;
        
        ctx.drawImage(bitmap, dx, dy, sourceTileSize, sourceTileSize);
        
        // Explicitly close the bitmap to free memory immediately
        bitmap.close();
        return { ok: true, x: child.x - startX, y: child.y - startY };
      } catch (err) {
        console.warn(`[Worker] Failed to decode tile: ${err}`);
        return { ok: false };
      }
    });

    const drawResults = await Promise.all(drawPromises);
    const decoded = drawResults.filter(result => result && result.ok);
    const decodedCells = decoded.map(result => `${result.x},${result.y}`).sort();
    if (decoded.length !== originalExpectedCount ||
        JSON.stringify(decodedCells) !== JSON.stringify(canonicalExpected)) {
      const decodeError = new Error(`MegaTile worker decoded ${decoded.length}/${originalExpectedCount} expected cells.`);
      decodeError.code = 'MEGATILE_WORKER_DECODE_INCOMPLETE';
      throw decodeError;
    }

    // Export the canvas to a PNG Blob
    const finalBlob = await canvas.convertToBlob({ type: 'image/png' });
    
    // Extract raw memory (ArrayBuffer)
    const arrayBuffer = await finalBlob.arrayBuffer();

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
    self.postMessage({
      id: id,
      status: 'error',
      outputPath: outputPath,
      code: error.code || 'MEGATILE_WORKER_FAILED',
      error: error.message || error.toString()
    });
  }
};
