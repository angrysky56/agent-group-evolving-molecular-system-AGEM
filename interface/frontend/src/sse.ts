export interface DecodedSseEvent {
  event: string;
  data: {
    [key: string]: unknown;
    type?: string;
    content?: string;
    message?: unknown;
    tool?: string;
    elapsed_ms?: number;
    output?: string;
  };
}

/** Incremental SSE decoder that also flushes a valid unterminated final frame. */
export class SseDecoder {
  #buffer = "";

  push(chunk: string, endOfStream = false): DecodedSseEvent[] {
    this.#buffer += chunk;
    const frames: string[] = [];
    while (true) {
      const boundary = this.#buffer.match(/\r?\n\r?\n/);
      if (!boundary?.index && boundary?.index !== 0) break;
      frames.push(this.#buffer.slice(0, boundary.index));
      this.#buffer = this.#buffer.slice(
        boundary.index + boundary[0].length,
      );
    }
    if (endOfStream && this.#buffer.trim()) {
      frames.push(this.#buffer);
      this.#buffer = "";
    }

    return frames.flatMap((frame) => {
      let event = "";
      const dataLines: string[] = [];
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith(":")) continue;
        if (line.startsWith("event:")) {
          event = line.slice("event:".length).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice("data:".length).trimStart());
        }
      }
      const payload = dataLines.join("\n").trim();
      if (!payload || payload === "[DONE]") return [];
      try {
        const data = JSON.parse(payload) as DecodedSseEvent["data"];
        return [{ event: event || String(data.type ?? "message"), data }];
      } catch {
        return [];
      }
    });
  }
}
