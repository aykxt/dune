export async function readFileChunks(file: Deno.File, len: number) {
  const blockData = new Uint8Array(len);
  let bytesRead = 0;
  while (bytesRead < len) {
    const tmp = new Uint8Array(len - bytesRead);
    const bytesReadTmp = await file.read(tmp);
    if (bytesReadTmp === null) break;
    blockData.set(tmp.subarray(0, bytesReadTmp), bytesRead);
    bytesRead += bytesReadTmp;
  }
  return blockData;
}
