/** Random-access muxer output without reallocating a contiguous video-sized buffer. */
export class ExportBuffer {
  private pages: Uint8Array<ArrayBuffer>[] = [];
  size = 0;

  constructor(private readonly pageSize = 4 * 1024 * 1024) {}

  write(position: number, data: Uint8Array) {
    let offset = 0;
    while (offset < data.byteLength) {
      const index = Math.floor(position / this.pageSize);
      const inPage = position % this.pageSize;
      const count = Math.min(this.pageSize - inPage, data.byteLength - offset);
      this.pages[index] ??= new Uint8Array(this.pageSize);
      this.pages[index].set(data.subarray(offset, offset + count), inPage);
      offset += count;
      position += count;
    }
    this.size = Math.max(this.size, position);
  }

  toBlob(type: string): Blob {
    const parts: Uint8Array<ArrayBuffer>[] = [];
    for (let offset = 0; offset < this.size; offset += this.pageSize) {
      const page =
        this.pages[offset / this.pageSize] ?? new Uint8Array(this.pageSize);
      parts.push(page.subarray(0, Math.min(this.pageSize, this.size - offset)));
    }
    return new Blob(parts, { type });
  }

  clear() {
    this.pages = [];
    this.size = 0;
  }
}
