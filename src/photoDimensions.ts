/** Read JPEG dimensions/orientation without decoding a multi-megapixel photo. */
export async function readPhotoDimensions(file: Blob): Promise<{ width: number; height: number } | null> {
  const buffer = await file.slice(0, 256 * 1024).arrayBuffer();
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
  let position = 2;
  let width = 0;
  let height = 0;
  let orientation = 1;
  while (position + 4 <= view.byteLength) {
    if (view.getUint8(position++) !== 0xff) return null;
    while (position < view.byteLength && view.getUint8(position) === 0xff) position++;
    if (position >= view.byteLength) return null;
    const marker = view.getUint8(position++);
    if (marker === 0xda || marker === 0xd9) break; // Compressed pixels / end of image.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (position + 2 > view.byteLength) return null;
    const length = view.getUint16(position);
    const end = position + length;
    if (length < 2 || end > view.byteLength) return null;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker) && length >= 7) {
      height = view.getUint16(position + 3);
      width = view.getUint16(position + 5);
    }
    if (marker === 0xe1 && length >= 16 && view.getUint32(position + 2) === 0x45786966
      && view.getUint16(position + 6) === 0) {
      const tiff = new DataView(buffer, position + 8, length - 8);
      const littleEndian = tiff.getUint16(0) === 0x4949;
      if ((littleEndian || tiff.getUint16(0) === 0x4d4d) && tiff.getUint16(2, littleEndian) === 42) {
        const directory = tiff.getUint32(4, littleEndian);
        if (directory + 2 <= tiff.byteLength) {
          const count = tiff.getUint16(directory, littleEndian);
          for (let index = 0; index < count; index++) {
            const entry = directory + 2 + index * 12;
            if (entry + 12 > tiff.byteLength) break;
            if (tiff.getUint16(entry, littleEndian) === 0x0112
              && tiff.getUint16(entry + 2, littleEndian) === 3
              && tiff.getUint32(entry + 4, littleEndian) === 1) {
              orientation = tiff.getUint16(entry + 8, littleEndian);
              break;
            }
          }
        }
      }
    }
    position = end;
  }
  if (!width || !height) return null;
  return orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height };
}