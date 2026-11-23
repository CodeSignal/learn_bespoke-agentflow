/**
 * Incremental parser for a `text/event-stream` body.
 *
 * Feed it decoded text with `push()`; it calls `onData` once per event with
 * the event's data (multiple `data:` lines joined with a newline). Comment
 * lines (starting with `:`, used as heartbeats), other fields, `\r\n` line
 * endings and events split across chunks are all handled. Call `flush()` when
 * the stream ends to deliver an event that was not followed by a blank line.
 */
export class SseParser {
    private buffer = '';

    private dataLines: string[] = [];

    constructor(private readonly onData: (data: string) => void) {}

    push(chunk: string): void {
        this.buffer += chunk;
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() ?? '';
        for (const line of lines) {
            this.processLine(line);
        }
    }

    flush(): void {
        if (this.buffer) {
            const line = this.buffer;
            this.buffer = '';
            this.processLine(line);
        }
        this.dispatch();
    }

    private processLine(rawLine: string): void {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        if (line === '') {
            this.dispatch();
            return;
        }
        if (line.startsWith(':')) return;
        if (line === 'data') {
            this.dataLines.push('');
            return;
        }
        if (!line.startsWith('data:')) return;
        const value = line.slice('data:'.length);
        this.dataLines.push(value.startsWith(' ') ? value.slice(1) : value);
    }

    private dispatch(): void {
        if (this.dataLines.length === 0) return;
        const data = this.dataLines.join('\n');
        this.dataLines = [];
        this.onData(data);
    }
}
